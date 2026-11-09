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

// Route snapshots as the store produces them: lowercase host keys, collector paths kept exactly.
const CHECKED = '2026-11-06T00:00:00.000Z';
const route = (component, path, port = 443) => ({ component, path, port });
const entry = (...routes) => ({ routes, fetchedAt: CHECKED });

const ROUTES = {
  'qouk4442-u.dedalus.lan': entry(
    route('u', '/u/'),
    route('iris', '/u/iris/'),
    route('iris-tracing', '/u/iris-tracing/'),
    route('iris-fhir', '/u/iris-fhir/'),
  ),
  'qouk4444-u.dedalus.lan': entry(route('u', '/u/')),
  'xode0804-proxy.orbis.dedalus.com': entry(route('u', '/u/')),
  'xode0804-u.dedalus.lan': entry(route('u', '/u/')),
  'qdev0001-u.dedalus.lan': entry(route('u', '/u/')),
  'other.dedalus.lan': entry(route('iris', '/u/iris/')),
};

const results = (query, routesByHost = ROUTES) => suggest(query, records, 30, routesByHost);
const urls = (query, routesByHost = ROUTES) => results(query, routesByHost).map((result) => result.url);

test('resolves the discovered iris endpoint from either token order and any letter case', () => {
  for (const query of ['qouk4442 iris', 'iris qouk4442', 'QOUK4442 IRIS', 'Iris QOUK4442']) {
    assert.deepEqual(urls(query), ['https://QOUK4442-U.DEDALUS.LAN/u/iris/'], query);
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
    results('qouk4442 ir').map((result) => result.product).sort(),
    ['iris', 'iris-fhir', 'iris-tracing'],
  );
  assert.deepEqual(results('qouk4442 iris-f').map((result) => result.product), ['iris-fhir']);
  assert.deepEqual(results('qouk4442 b').map((result) => result.product), ['bpe']);
  assert.equal(results('qouk4442 iris')[0].product, 'iris');
});

test('an exact database name does not also suggest longer database names', () => {
  assert.deepEqual([...new Set(results('qouk4442').map(result => result.db))], ['QOUK4442']);
  assert.deepEqual([...new Set(results('qouk44420').map(result => result.db))], ['QOUK44420']);
});

test('a partial database name suggests every matching database', () => {
  const databases = [...new Set(results('qouk444').map((result) => result.db))].sort();
  assert.deepEqual(databases, ['QOUK4442', 'QOUK44420', 'QOUK4444']);
});

test('no endpoint is produced when the required software is absent', () => {
  assert.deepEqual(urls('qouk4444 oas'), []);
  assert.deepEqual(urls('xtypo0001 oas'), []);
  assert.deepEqual(urls('qouk4444 u'), ['https://QOUK4444-U.DEDALUS.LAN/u/']);
  assert.deepEqual(urls('xtypo0001 u'), []);
});

test('duplicate targets merge before limits without hiding a distinct target', () => {
  const original = qa.find(record => record.db === 'QOUK4442');
  const repeated = Array.from({ length: 40 }, (_, index) => ({
    ...original, id: `duplicate-${index}`, sourceId: 'dev', type: 'DEV-FROZEN',
    proxyHosts: ['qouk4442-u.dedalus.lan'],
  }));
  const other = { ...original, id: 'alternative', proxyHosts: ['OTHER.DEDALUS.LAN'] };
  assert.deepEqual(suggest('qouk4442 iris', [original, ...repeated], 2, ROUTES).map(result => result.url),
    ['https://QOUK4442-U.DEDALUS.LAN/u/iris/']);
  assert.deepEqual(suggest('qouk4442 iris', [original, ...repeated, other], 2, ROUTES).map(result => result.url),
    ['https://QOUK4442-U.DEDALUS.LAN/u/iris/', 'https://OTHER.DEDALUS.LAN/u/iris/']);
});

test('keeps ambiguous distinct hosts as separate, labelled suggestions', () => {
  const found = results('xode0804 u');
  assert.deepEqual(
    found.map((result) => result.url).sort(),
    ['https://XODE0804-PROXY.ORBIS.DEDALUS.COM/u/', 'https://XODE0804-U.DEDALUS.LAN/u/'],
  );
  const descriptions = found.map((result) => result.description);
  assert.equal(new Set(descriptions).size, 2);
});

test('excludes unsupported regions and rejects unknown tokens', () => {
  assert.deepEqual(urls('qous0001 u'), []);
  assert.deepEqual(urls('qouk4442 nope'), []);
  assert.deepEqual(urls('nope'), []);
  assert.deepEqual(urls('qouk4442 iris extra'), []);
  assert.deepEqual(suggest('   ', records, 30, ROUTES), []);
});

test('fixed Jira aliases return the editable prefix for every alias', () => {
  const cases = [
    [['bug', 'orbisbug', 'defect', 'Bug'], 'ORBISBUG-'],
    [['hconn', 'story'], 'HCONN-'],
    [['hepic', 'epic'], 'HEPIC-'],
  ];
  for (const [aliases, prefix] of cases) {
    for (const alias of aliases) {
      const [result] = results(alias);
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
    const [result] = results(query);
    assert.equal(result.kind, 'jira', query);
    assert.equal(result.url, url, query);
  }
});

test('rejects invalid Jira numeric ids', () => {
  for (const query of ['bug 12a', 'bug 0', 'bug 01', 'bug 1-2']) {
    assert.deepEqual(results(query), [], query);
  }
});

test('recognizes the exact Jira prefix URL and numeric ticket URLs', () => {
  const [prefix] = results(`${JIRA}HCONN-`);
  assert.equal(prefix.kind, 'jira-prefix');
  assert.equal(prefix.completion, `${JIRA}HCONN-`);

  const [ticket] = results(`${JIRA}HCONN-9`);
  assert.equal(ticket.kind, 'jira');
  assert.equal(ticket.url, `${JIRA}HCONN-9`);

  assert.deepEqual(results(`${JIRA}HCONN-x`), []);
  assert.deepEqual(results(`${JIRA}OTHER-9`), []);
  assert.deepEqual(results('https://evil.example/browse/HCONN-9'), []);
});

test('allows only generated endpoints and numeric fixed Jira tickets as destinations', () => {
  const allowed = [
    'https://QOUK4442-U.DEDALUS.LAN/u/iris/',
    'https://QOUK4442-U.DEDALUS.LAN/u/',
    'https://QOUK4442-U.DEDALUS.LAN/u/iris-tracing/',
    'https://QOUK4442-OAS.DEDALUS.LAN:8443/webstart',
    'https://QOUK4442-OAS.DEDALUS.LAN:8443/ucc',
    'https://QOUK4442-OAS.DEDALUS.LAN:9993/console/index.html',
    'https://XODE0804-PROXY.ORBIS.DEDALUS.COM/u/',
    'https://qouk4442-u.dedalus.lan/u/iris/',
    `${JIRA}ORBISBUG-42`,
    `${JIRA}HEPIC-1`,
  ];
  for (const url of allowed) {
    assert.equal(isAllowedDestination(url, records, ROUTES), true, url);
  }

  const rejected = [
    'https://QOUK4442-U.DEDALUS.LAN/U/iris/',
    'https://QOUK4442-U.DEDALUS.LAN/u/Iris/',
    'https://QOUK4442-U.DEDALUS.LAN/u/iris',
    'https://QOUK4442-U.DEDALUS.LAN/u/iris/extra/',
    'https://QOUK4442-U.DEDALUS.LAN:443/u/iris/',
    'https://QOUK4442-U.DEDALUS.LAN:9443/u/iris/',
    'http://QOUK4442-U.DEDALUS.LAN/u/iris/',
    'https://user@QOUK4442-U.DEDALUS.LAN/u/iris/',
    'https://QOUK4442-U.DEDALUS.LAN/u/iris/?x=1',
    'https://evil.example/u/iris/',
    'https://QOUK4444-U.DEDALUS.LAN/u/iris/',
    'https://QOUK44420-U.DEDALUS.LAN/u/',
    'https://QOUK4442-OAS.DEDALUS.LAN/webstart',
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
    assert.equal(isAllowedDestination(url, records, ROUTES), false, String(url));
  }
});

test('proxy destinations are never allowed without discovered routes', () => {
  assert.equal(isAllowedDestination('https://QOUK4442-U.DEDALUS.LAN/u/', records), false);
  assert.equal(isAllowedDestination('https://QOUK4442-U.DEDALUS.LAN/u/', records, {}), false);
  assert.equal(isAllowedDestination('https://QOUK4442-OAS.DEDALUS.LAN:8443/ucc', records), true);
});

test('discovered products outside the old list resolve from either token order and any prefix', () => {
  const routes = { 'qouk4442-u.dedalus.lan': entry(route('reports', '/reports/', 9443)) };
  const expected = ['https://QOUK4442-U.DEDALUS.LAN:9443/reports/'];
  for (const query of ['qouk4442 reports', 'reports qouk4442', 'QOUK4442 REP', 'rep qouk4442']) {
    assert.deepEqual(urls(query, routes), expected, query);
  }
  assert.equal(results('qouk4442 reports', routes)[0].product, 'reports');
  assert.equal(isAllowedDestination(expected[0], records, routes), true);
  assert.equal(isAllowedDestination(expected[0], records, {}), false);
});

test('keeps the reported path exactly and omits only the default port', () => {
  const routes = { 'qouk4442-u.dedalus.lan': entry(route('u', '/u'), route('iris', '/u/iris/', 8443)) };
  assert.deepEqual(urls('qouk4442 u', routes), ['https://QOUK4442-U.DEDALUS.LAN/u']);
  assert.deepEqual(urls('qouk4442 iris', routes), ['https://QOUK4442-U.DEDALUS.LAN:8443/u/iris/']);
});

test('without proxy routes tokens still prefix-complete static products but never guess a proxy endpoint', () => {
  assert.deepEqual(urls('qouk4442 u', {}), ['https://QOUK4442-OAS.DEDALUS.LAN:8443/ucc']);
  assert.deepEqual(urls('qouk4444 u', {}), []);
  assert.deepEqual(urls('qouk4442 iris', { 'qouk4442-u.dedalus.lan': entry() }), []);
  assert.deepEqual(urls('qouk4442 u', { 'other.dedalus.lan': entry(route('u', '/u/')) }),
    ['https://QOUK4442-OAS.DEDALUS.LAN:8443/ucc']);
  assert.deepEqual(urls('qouk4442 oas', {}), ['https://QOUK4442-OAS.DEDALUS.LAN:9993/console/index.html']);
});

test('the same product on different hosts and paths stays as separate, exact targets', () => {
  const routes = {
    'xode0804-proxy.orbis.dedalus.com': entry(route('iris', '/u/iris/')),
    'xode0804-u.dedalus.lan': entry(route('iris', '/u/iris/'), route('iris', '/iris/', 9443)),
  };
  const found = results('xode0804 iris', routes);
  assert.deepEqual(found.map((result) => result.url).sort(), [
    'https://XODE0804-PROXY.ORBIS.DEDALUS.COM/u/iris/',
    'https://XODE0804-U.DEDALUS.LAN/u/iris/',
    'https://XODE0804-U.DEDALUS.LAN:9443/iris/',
  ]);
  assert.deepEqual(new Set(found.map((result) => result.product)), new Set(['iris']));
  for (const result of found) {
    assert.equal(isAllowedDestination(result.url, records, routes), true, result.url);
  }
});

test('a component reported twice for the same URL merges into one suggestion', () => {
  const routes = { 'qouk4442-u.dedalus.lan': entry(route('iris', '/u/iris/'), route('Iris', '/u/iris/')) };
  assert.deepEqual(urls('qouk4442 iris', routes), ['https://QOUK4442-U.DEDALUS.LAN/u/iris/']);
});

test('discovered routes never apply to another environment', () => {
  assert.deepEqual(urls('qouk44420 iris'), []);
  assert.deepEqual(urls('qouk44420 u'), ['https://QOUK44420-OAS.DEDALUS.LAN:8443/ucc']);
  assert.deepEqual(urls('qouk4442 iris', { 'qouk44420-u.dedalus.lan': entry(route('iris', '/u/iris/')) }), []);
});

test('malformed route entries are ignored and valid entries still resolve', () => {
  const routes = {
    'qouk4442-u.dedalus.lan': entry(
      route('iris', '/u/iris?x=1'),
      route('iris', 'u/iris/'),
      route('iris', '/u/iris/', 0),
      route('iris', '/u/iris/', 70000),
      route('iris', '/u/iris/', '443'),
      route('', '/u/empty/'),
      route('iris', '/u/iris/ extra'),
    ),
  };
  assert.deepEqual(urls('qouk4442 iris', routes), []);
  routes['qouk4442-u.dedalus.lan'].routes.push(route('iris', '/u/iris/'));
  assert.deepEqual(urls('qouk4442 iris', routes), ['https://QOUK4442-U.DEDALUS.LAN/u/iris/']);
});

test('discovered products named like Jira aliases resolve in either token order', () => {
  const routes = { 'qouk4442-u.dedalus.lan': entry(route('epic', '/products/epic/')) };
  const expected = ['https://QOUK4442-U.DEDALUS.LAN/products/epic/'];
  assert.deepEqual(urls('qouk4442 epic', routes), expected);
  assert.deepEqual(urls('epic qouk4442', routes), expected);
  assert.deepEqual(urls('epic 777', routes), [`${JIRA}HEPIC-777`]);
});
