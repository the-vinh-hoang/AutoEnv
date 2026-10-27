import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnvironments } from '../src/catalog.js';

const OAS = 'OAS - CON - standard:single';
const PROXY = 'ORBIS PROXY';

const software = (name, server) =>
  `<software name="${name}" sw_type_name="ORBIS Service"><server>${server}</server><port>0</port></software>`;
const environment = (db, region, ...softwares) =>
  `<environment><region>${region}</region><db>${db}</db><software_installations>${softwares.join('')}</software_installations></environment>`;
const group = (type, ...environments) =>
  `<environment_type type="${type}">${environments.join('')}</environment_type>`;
const snapshot = (...groups) =>
  `<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<environments lastupdate="27.10.2026 13:22">${groups.join('')}</environments>`;

test('rejects DTD and entity declarations before parsing', () => {
  const xml = snapshot(group('QA', environment('QOUK4442', 'DACHL', software(PROXY, '&host;'))))
    .replace('<environments', '<!DOCTYPE environments [<!ENTITY host "QOUK.DEDALUS.LAN">]><environments');
  assert.throws(() => parseEnvironments(xml, 'qa'), /DTD and entity declarations/);
});

test('rejects malformed XML', () => {
  const xml = snapshot(group('QA', environment('QOUK4442', 'DACHL'))).replace('</environments>', '');
  assert.throws(() => parseEnvironments(xml, 'qa'), /malformed XML/);
});

test('rejects a document whose root is not environments', () => {
  const xml = '<?xml version="1.0"?><catalog lastupdate="x"></catalog>';
  assert.throws(() => parseEnvironments(xml, 'qa'), /root element must be <environments>/);
});

test('rejects a snapshot without lastupdate', () => {
  const xml = snapshot(group('QA', environment('QOUK4442', 'DACHL', software(PROXY, 'QOUK4442-U.DEDALUS.LAN'))))
    .replace(' lastupdate="27.10.2026 13:22"', '');
  assert.throws(() => parseEnvironments(xml, 'qa'), /lastupdate/);
});

test('rejects empty input and unknown source ids', () => {
  const xml = snapshot(group('QA', environment('QOUK4442', 'DACHL', software(PROXY, 'QOUK4442-U.DEDALUS.LAN'))));
  assert.throws(() => parseEnvironments('   ', 'qa'), /document is empty/);
  assert.throws(() => parseEnvironments(xml, 'prod'), /Unknown source/);
});

test('rejects hosts that carry a port, path, protocol, userinfo or invalid labels', () => {
  const badHosts = [
    'QOUK4442-U.DEDALUS.LAN:8443',
    'https://QOUK4442-U.DEDALUS.LAN',
    'user@QOUK4442-U.DEDALUS.LAN',
    'QOUK4442-U.DEDALUS.LAN/u',
    '-bad.DEDALUS.LAN',
    'a..DEDALUS.LAN',
    'QOUK_4442.DEDALUS.LAN',
  ];
  for (const host of badHosts) {
    const xml = snapshot(group('QA', environment('QOUK4442', 'DACHL', software(PROXY, host))));
    assert.throws(() => parseEnvironments(xml, 'qa'), /unsafe host/, host);
  }
});

test('keeps supported regions for every environment type and drops other regions', () => {
  const xml = snapshot(
    group('ESI', environment('ESI0001', 'DACHL', software(PROXY, 'ESI0001-U.DEDALUS.LAN'))),
    group('PreQA', environment('PQA0001', 'AU'), environment('PQA0002', 'FR'), environment('PQA0003', 'UKI')),
    group('QA', environment('XUS0001', 'US', software(PROXY, 'XUS0001-U.DEDALUS.LAN'))),
  );
  const { records } = parseEnvironments(xml, 'qa');
  assert.deepEqual(
    records.map((record) => [record.type, record.region, record.db]),
    [
      ['ESI', 'DACHL', 'ESI0001'],
      ['PreQA', 'AU', 'PQA0001'],
      ['PreQA', 'FR', 'PQA0002'],
      ['PreQA', 'UKI', 'PQA0003'],
    ],
  );
  assert.ok(records.every((record) => record.sourceId === 'qa'));
});

test('does not invent endpoints for missing or misnamed software', () => {
  const xml = snapshot(
    group(
      'QA',
      environment('ONLYPROXY', 'DACHL', software(PROXY, 'ONLYPROXY-U.DEDALUS.LAN')),
      environment('NOSOFT', 'DACHL'),
      environment(
        'TYPO',
        'DACHL',
        software('OAS - CON - stadard:single', 'TYPO-OAS.DEDALUS.LAN'),
        software('ORBISU PROXY', 'TYPO-ORBISU.DEDALUS.LAN'),
      ),
    ),
  );
  const byDb = Object.fromEntries(parseEnvironments(xml, 'qa').records.map((record) => [record.db, record]));
  assert.deepEqual(byDb.ONLYPROXY.oasHosts, []);
  assert.deepEqual(byDb.ONLYPROXY.proxyHosts, ['ONLYPROXY-U.DEDALUS.LAN']);
  assert.deepEqual(byDb.NOSOFT.oasHosts, []);
  assert.deepEqual(byDb.NOSOFT.proxyHosts, []);
  assert.deepEqual(byDb.TYPO.oasHosts, []);
  assert.deepEqual(byDb.TYPO.proxyHosts, []);
});

test('keeps distinct host alternatives in document order and collapses identical repeats', () => {
  const xml = snapshot(
    group(
      'QA',
      environment(
        'QOUK4442',
        'DACHL',
        software(PROXY, 'QOUK4442-PROXY.ORBIS.DEDALUS.COM'),
        software(PROXY, 'QOUK4442-U.DEDALUS.LAN'),
        software(PROXY, 'QOUK4442-PROXY.ORBIS.DEDALUS.COM'),
      ),
    ),
  );
  const [record] = parseEnvironments(xml, 'qa').records;
  assert.deepEqual(record.proxyHosts, ['QOUK4442-PROXY.ORBIS.DEDALUS.COM', 'QOUK4442-U.DEDALUS.LAN']);
});

test('gives duplicate database rows distinct ids and keeps each row with its own hosts', () => {
  const xml = snapshot(
    group(
      'QA',
      environment('XODE0804', 'DACHL', software(PROXY, 'XODE0804-PROXY.ORBIS.DEDALUS.COM')),
      environment('XODE0804', 'DACHL', software(PROXY, 'XODE0804-U.DEDALUS.LAN')),
    ),
  );
  const [first, second] = parseEnvironments(xml, 'qa').records;
  assert.equal(first.db, 'XODE0804');
  assert.equal(second.db, 'XODE0804');
  assert.notEqual(first.id, second.id);
  assert.deepEqual(first.proxyHosts, ['XODE0804-PROXY.ORBIS.DEDALUS.COM']);
  assert.deepEqual(second.proxyHosts, ['XODE0804-U.DEDALUS.LAN']);
});

test('keeps text values as strings without number coercion', () => {
  const xml = snapshot(group('QA', environment('008000', 'DACHL', software(PROXY, 'X008000-U.DEDALUS.LAN'))));
  const [record] = parseEnvironments(xml, 'qa').records;
  assert.equal(record.db, '008000');
  assert.equal(parseEnvironments(xml, 'qa').updatedAt, '27.10.2026 13:22');
});

test('rejects a snapshot with no supported environments', () => {
  const xml = snapshot(group('QA', environment('XUS0001', 'US')));
  assert.throws(() => parseEnvironments(xml, 'qa'), /no supported environments/);
});
