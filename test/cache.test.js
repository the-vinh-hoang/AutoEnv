import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogStore, catalogStatus } from '../src/cache.js';

function xml(db, host) {
  return `<environments lastupdate="27.10.2026"><environment_type type="QA"><environment><region>UKI</region><db>${db}</db><software_installations><software name="ORBIS PROXY"><server>${host}</server></software></software_installations></environment></environment_type></environments>`;
}

function memoryStorage() {
  let values = {};
  return {
    fail: false,
    async get() { return structuredClone(values); },
    async set(next) {
      if (this.fail) throw new Error('Storage quota exceeded');
      values = structuredClone({ ...values, ...next });
    },
  };
}

test('offline installation persists both XML files and a new worker uses the same cache', async () => {
  const storage = memoryStorage();
  const store = createCatalogStore({ storage, fetchXml: async (source, bundled) => {
    assert.equal(bundled, true, 'first installation must not depend on the network');
    return xml(source.id === 'qa' ? 'QOUK4442' : 'EOUK444A', 'original.dedalus.lan');
  } });
  const snapshot = await store.getSnapshot();
  assert.deepEqual(snapshot.sources.map(source => source.records[0].db), ['QOUK4442', 'EOUK444A']);
  assert.equal(snapshot.sources[0].xml, xml('QOUK4442', 'original.dedalus.lan'));
  const restarted = createCatalogStore({ storage, fetchXml: () => { throw new Error('Offline'); } });
  assert.deepEqual(await restarted.getSnapshot(), snapshot);
  assert.equal(catalogStatus(snapshot).bundled, true);
});

test('a failed source refresh preserves both old sources, then successful refresh replaces both', async () => {
  const storage = memoryStorage();
  let mode = 'bundled';
  const store = createCatalogStore({ storage, fetchXml: async (source, bundled) => {
    if (!bundled && mode === 'failure' && source.id === 'dev') throw new Error('Network unavailable');
    return xml(source.id === 'qa' ? 'QOUK4442' : 'EOUK444A', `${bundled ? 'old' : 'new'}.dedalus.lan`);
  } });
  const old = await store.getSnapshot();
  mode = 'failure';
  await assert.rejects(store.refresh(), /Network unavailable/);
  assert.deepEqual(await store.getSnapshot(), old);
  assert.deepEqual((await storage.get()).catalog, old);
  mode = 'success';
  const updated = await store.refresh();
  assert.deepEqual(updated.sources.map(source => source.records[0].proxyHosts), [['new.dedalus.lan'], ['new.dedalus.lan']]);
  assert.equal(updated.bundled, false);
  assert.deepEqual((await storage.get()).catalog, updated);
});

test('a persistence failure never installs an unpersisted replacement in memory', async () => {
  const storage = memoryStorage();
  const store = createCatalogStore({ storage, fetchXml: async (source, bundled) => xml('QOUK4442', `${bundled ? 'old' : 'new'}.dedalus.lan`) });
  const old = await store.getSnapshot();
  storage.fail = true;
  await assert.rejects(store.refresh(), /Storage quota/);
  assert.deepEqual(await store.getSnapshot(), old);
  storage.fail = false;
  const restarted = createCatalogStore({ storage, fetchXml: () => { throw new Error('Offline'); } });
  assert.deepEqual(await restarted.getSnapshot(), old);
});
