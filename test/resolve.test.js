import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnvironments } from '../src/catalog.js';
import { isAllowedDestination, suggest } from '../src/resolve.js';

const OAS = 'OAS - CON - standard:single';
const PROXY = 'ORBIS PROXY';
const JIRA = 'https://dedalus.atlassian.net/browse/';

const software = (name, server) =>
  `<software name="${name}" sw_type_name="ORBIS Service"><server>${server}</server><port>0</port></software>`;
const environment = (db, region, ...softwares) =>
  `<environment><region>${region}</region><db>${db}</db><software_installations>${softwares.join('')}</software_installations></environment>`;
const group = (type, ...environments) =>
  `<environment_type type="${type}">${environments.join('')}</environment_type>`;
const snapshot = (...groups) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<environments lastupdate="27.10.2026 13:22">${groups.join('')}</environments>`;

const qa = parseEnvironments(
  snapshot(
    group(
      'QA',
      environment(
        'QOUK4442',
        'DACHL',
        software(OAS, 'QOUK4442-OAS.DEDALUS.LAN'),
        software(PROXY, 'QOUK4442-U.DEDALUS.LAN'),
        software('OAS - APP - application:fhir', 'QOUK4442-FHIR.DEDALUS.LAN'),
        software('OAS - APP - application:fhir-back-end', 'QOUK4442-FHIR-BE.DEDALUS.LAN'),
      ),
      environment(
        'QOUK44420',
        'DACHL',
        software(OAS, 'QOUK44420-OAS.DEDALUS.LAN'),
        software(PROXY, 'QOUK44420-U.DEDALUS.LAN'),
      ),
      environment('QOUK4444', 'UKI', software(PROXY, 'QOUK4444-U.DEDALUS.LAN')),
      environment('XODE0804', 'DACHL', software(PROXY, 'XODE0804-PROXY.ORBIS.DEDALUS.COM')),
      environment('XODE0804', 'DACHL', software(PROXY, 'XODE0804-U.DEDALUS.LAN')),
      environment('XTYPO0001', 'FR', software('OAS - CON - stadard:single', 'XTYPO0001-OAS.DEDALUS.LAN')),
      environment('QOUS0001', 'US', software(OAS, 'QOUS0001-OAS.DEDALUS.LAN'), software(PROXY, 'QOUS0001-U.DEDALUS.LAN')),
    ),
  ),
  'qa',
).records;

const dev = parseEnvironments(
  snapshot(group('DEV Sandbox', environment('QDEV0001', 'AU', software(PROXY, 'QDEV0001-U.DEDALUS.LAN')))),
  'dev',
).records;

const records = [...qa, ...dev];
const urls = (query) => suggest(query, records).map((result) => result.url);

test('resolves the iris endpoint from either token order and any letter case', () => {
  for (const query of ['qouk4442 iris', 'iris qouk4442', 'QOUK4442 IRIS', 'Iris QOUK4442']) {
    assert.deepEqual(urls(query), ['https://QOUK4442-U.DEDALUS.LAN/u/iris'], query);
  }
});

test('applies every OAS rule with its fixed port and path', () => {
  const host = 'https://QOUK4442-OAS.DEDALUS.LAN';
  const expected = {
    webstart: `${host}:8443/webstart`,
    bpe: `${host}:8443/webstart`,
    ucc: `${host}:8443/ucc`,
    oas: `${host}:9993/console/index.html`,
    console: `${host}:9993/console/index.html`,
  };
  for (const [product, url] of Object.entries(expected)) {
    assert.deepEqual(urls(`qouk4442 ${product}`), [url], product);
  }
});

test('applies every ORBISU rule on the default HTTPS port', () => {
  const host = 'https://QOUK4442-U.DEDALUS.LAN';
  assert.deepEqual(urls('qouk4442 u'), [`${host}/u`]);
  assert.deepEqual(urls('qouk4442 iris-tracing'), [`${host}/u/iris-tracing`]);
  assert.deepEqual(urls('qouk4442 iris-fhir'), [`${host}/u/iris-fhir`]);
});

test('FHIR consoles select separate application hosts without expanding an exact fhir match', () => {
  const expected = {
    fhir: 'https://QOUK4442-FHIR.DEDALUS.LAN:9993/console/index.html',
    'fhir-back-end': 'https://QOUK4442-FHIR-BE.DEDALUS.LAN:9993/console/index.html',
  };
  for (const [product, url] of Object.entries(expected)) {
    assert.deepEqual(urls(`qouk4442 ${product}`), [url]);
    assert.deepEqual(urls(`${product.toUpperCase()} QOUK4442`), [url]);
    assert.equal(isAllowedDestination(url, records), true);
    assert.equal(isAllowedDestination(url.replace(':9993', ':8443'), records), false);
  }
  assert.deepEqual(urls('qouk4442 fhir-b'), [expected['fhir-back-end']]);
});

test('missing FHIR applications never fall back to another application or the proxy', () => {
  const partial = parseEnvironments(snapshot(group('QA', environment(
    'FHIRONLY', 'UKI',
    software(OAS, 'CONSOLE.DEDALUS.LAN'),
    software(PROXY, 'PROXY.DEDALUS.LAN'),
    software('OAS - APP - application:fhir-back-end', 'BACKEND.DEDALUS.LAN'),
    software('OAS - APP - application:fhir-extra', 'UNRELATED.DEDALUS.LAN'),
  ))), 'qa').records;
  assert.deepEqual(suggest('fhironly fhir', partial), []);
  assert.deepEqual(suggest('fhironly fhir-back-end', partial).map(result => result.url),
    ['https://BACKEND.DEDALUS.LAN:9993/console/index.html']);
  assert.deepEqual(urls('qouk4444 fhir-back-end'), []);
});

test('completes partial products and ranks the exact product first', () => {
  assert.deepEqual(
    suggest('qouk4442 ir', records).map((result) => result.product).sort(),
    ['iris', 'iris-fhir', 'iris-tracing'],
  );
  assert.deepEqual(suggest('qouk4442 iris-f', records).map((result) => result.product), ['iris-fhir']);
  assert.deepEqual(suggest('qouk4442 b', records).map((result) => result.product), ['bpe']);
  assert.equal(suggest('qouk4442 iris', records)[0].product, 'iris');
});

test('an exact database name does not also suggest longer database names', () => {
  assert.deepEqual([...new Set(suggest('qouk4442', records).map(result => result.db))], ['QOUK4442']);
  assert.deepEqual([...new Set(suggest('qouk44420', records).map(result => result.db))], ['QOUK44420']);
});

test('a partial database name suggests every matching database', () => {
  const databases = [...new Set(suggest('qouk444', records).map((result) => result.db))].sort();
  assert.deepEqual(databases, ['QOUK4442', 'QOUK44420', 'QOUK4444']);
});

test('no endpoint is produced when the required software is absent', () => {
  assert.deepEqual(urls('qouk4444 oas'), []);
  assert.deepEqual(urls('xtypo0001 oas'), []);
  assert.deepEqual(urls('qouk4444 u'), ['https://QOUK4444-U.DEDALUS.LAN/u']);
  assert.deepEqual(urls('xtypo0001 u'), []);
});

test('duplicate targets merge before limits without hiding a distinct target', () => {
  const original = qa.find(record => record.db === 'QOUK4442');
  const repeated = Array.from({ length: 40 }, (_, index) => ({
    ...original, id: `duplicate-${index}`, sourceId: 'dev', type: 'DEV-FROZEN',
    proxyHosts: ['qouk4442-u.dedalus.lan'],
  }));
  const other = { ...original, id: 'alternative', proxyHosts: ['OTHER.DEDALUS.LAN'] };
  assert.deepEqual(suggest('qouk4442 iris', [original, ...repeated], 2).map(result => result.url),
    ['https://QOUK4442-U.DEDALUS.LAN/u/iris']);
  assert.deepEqual(suggest('qouk4442 iris', [original, ...repeated, other], 2).map(result => result.url),
    ['https://QOUK4442-U.DEDALUS.LAN/u/iris', 'https://OTHER.DEDALUS.LAN/u/iris']);
});

test('keeps ambiguous distinct hosts as separate, labelled suggestions', () => {
  const results = suggest('xode0804 u', records);
  assert.deepEqual(
    results.map((result) => result.url).sort(),
    ['https://XODE0804-PROXY.ORBIS.DEDALUS.COM/u', 'https://XODE0804-U.DEDALUS.LAN/u'],
  );
  const descriptions = results.map((result) => result.description);
  assert.equal(new Set(descriptions).size, 2);
});


test('excludes unsupported regions and rejects unknown tokens', () => {
  assert.deepEqual(urls('qous0001 u'), []);
  assert.deepEqual(urls('qouk4442 nope'), []);
  assert.deepEqual(urls('nope'), []);
  assert.deepEqual(urls('qouk4442 iris extra'), []);
  assert.deepEqual(suggest('   ', records), []);
});

test('fixed Jira aliases return the editable prefix for every alias', () => {
  const cases = [
    [['bug', 'orbisbug', 'defect', 'Bug'], 'ORBISBUG-'],
    [['hconn', 'story'], 'HCONN-'],
    [['hepic', 'epic'], 'HEPIC-'],
  ];
  for (const [aliases, prefix] of cases) {
    for (const alias of aliases) {
      const [result] = suggest(alias, records);
      assert.equal(result.kind, 'jira-prefix', alias);
      assert.equal(result.completion, `${JIRA}${prefix}`, alias);
      assert.equal(result.url, `${JIRA}${prefix}`, alias);
    }
  }
});

test('a Jira alias with a numeric id resolves to that ticket', () => {
  const cases = [
    ['bug 123', `${JIRA}ORBISBUG-123`],
    ['bug-123', `${JIRA}ORBISBUG-123`],
    ['BUG   123', `${JIRA}ORBISBUG-123`],
    ['story-45', `${JIRA}HCONN-45`],
    ['epic 7', `${JIRA}HEPIC-7`],
  ];
  for (const [query, url] of cases) {
    const [result] = suggest(query, records);
    assert.equal(result.kind, 'jira', query);
    assert.equal(result.url, url, query);
  }
});

test('rejects invalid Jira numeric ids', () => {
  for (const query of ['bug 12a', 'bug 0', 'bug 01', 'bug 1-2']) {
    assert.deepEqual(suggest(query, records), [], query);
  }
});

test('recognizes the exact Jira prefix URL and numeric ticket URLs', () => {
  const [prefix] = suggest(`${JIRA}HCONN-`, records);
  assert.equal(prefix.kind, 'jira-prefix');
  assert.equal(prefix.completion, `${JIRA}HCONN-`);

  const [ticket] = suggest(`${JIRA}HCONN-9`, records);
  assert.equal(ticket.kind, 'jira');
  assert.equal(ticket.url, `${JIRA}HCONN-9`);

  assert.deepEqual(suggest(`${JIRA}HCONN-x`, records), []);
  assert.deepEqual(suggest(`${JIRA}OTHER-9`, records), []);
  assert.deepEqual(suggest('https://evil.example/browse/HCONN-9', records), []);
});

test('allows only generated endpoints and numeric fixed Jira tickets as destinations', () => {
  const allowed = [
    'https://QOUK4442-U.DEDALUS.LAN/u/iris',
    'https://QOUK4442-OAS.DEDALUS.LAN:8443/webstart',
    'https://QOUK4442-OAS.DEDALUS.LAN:8443/ucc',
    'https://QOUK4442-OAS.DEDALUS.LAN:9993/console/index.html',
    'https://XODE0804-PROXY.ORBIS.DEDALUS.COM/u',
    'https://qouk4442-u.dedalus.lan/u/iris',
    `${JIRA}ORBISBUG-42`,
    `${JIRA}HEPIC-1`,
  ];
  for (const url of allowed) {
    assert.equal(isAllowedDestination(url, records), true, url);
  }

  const rejected = [
    'https://QOUK4442-U.DEDALUS.LAN/U/iris',
    'https://QOUK4442-U.DEDALUS.LAN/u/Iris',
    'https://QOUK4442-OAS.DEDALUS.LAN/webstart',
    'https://QOUK4442-OAS.DEDALUS.LAN:9993/webstart',
    'https://QOUK4442-U.DEDALUS.LAN:443/u/iris',
    'http://QOUK4442-U.DEDALUS.LAN/u/iris',
    'https://user@QOUK4442-U.DEDALUS.LAN/u/iris',
    'https://QOUK4442-U.DEDALUS.LAN/u/iris/',
    'https://QOUK4442-U.DEDALUS.LAN/u/iris?x=1',
    'https://evil.example/u/iris',
    'https://QOUK4444-OAS.DEDALUS.LAN:8443/webstart',
    `${JIRA}HCONN-`,
    `${JIRA}HCONN-01`,
    `${JIRA}hconn-1`,
    `${JIRA}OTHER-1`,
    `${JIRA}HCONN-1?x=1`,
    'https://dedalus.atlassian.net.evil.example/browse/HCONN-1',
    'http://dedalus.atlassian.net/browse/HCONN-1',
    undefined,
  ];
  for (const url of rejected) {
    assert.equal(isAllowedDestination(url, records), false, String(url));
  }
});
