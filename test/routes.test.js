import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouteStore, parseRoutes } from '../src/routes.js';

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

function entry(component, location, port = 443) {
  return { component, 'proxy-location': location, 'proxy-port': port };
}

test('parses component, location and port from the collector without hardcoded products', () => {
  const routes = parseRoutes([
    entry('u', '/u/'),
    entry('reporting', '/u/reporting/', 9443),
    entry('', '/unnamed/'),
    entry('two words', '/multi/'),
    entry('u', '/u/'),
  ]);
  assert.deepEqual(routes, [
    { component: 'u', path: '/u/', port: 443 },
    { component: 'reporting', path: '/u/reporting/', port: 9443 },
  ]);
});

test('keeps every endpoint of one component, including the same path on another port', () => {
  const routes = parseRoutes([
    entry('iris', '/u/iris/', 443),
    entry('iris', '/u/iris-alt/', 443),
    entry('iris', '/u/iris/', 8443),
  ]);
  assert.deepEqual(routes.map(route => [route.path, route.port]), [
    ['/u/iris/', 443], ['/u/iris-alt/', 443], ['/u/iris/', 8443],
  ]);
});

test('rejects unsafe paths and invalid ports while keeping valid siblings', () => {
  const unsafePaths = [
    'https://evil.example/u/', '//evil.example/u/', '\\u\\', '/u /', '/u?x=1', '/u#frag',
    '/u/../admin', '/u/./x', '/u/%2e%2e/admin', '/u/%2F', '/u/%5c', '/u/%0a', '/u/%zz',
    '/caf\u00e9/', 'u/', '',
  ];
  for (const location of unsafePaths) {
    assert.deepEqual(parseRoutes([entry('bad', location), entry('good', '/u/')]),
      [{ component: 'good', path: '/u/', port: 443 }], location);
  }
  for (const port of [0, 65536, -1, 443.5, '', 'abc', '0443', ['443'], null]) {
    assert.deepEqual(parseRoutes([entry('bad', '/u/', port), entry('good', '/u/')]),
      [{ component: 'good', path: '/u/', port: 443 }], String(port));
  }
});

test('an unexpected document shape is rejected rather than treated as an empty list', () => {
  assert.throws(() => parseRoutes({ routes: [] }), /expected a JSON array/);
  assert.throws(() => parseRoutes(null), /expected a JSON array/);
  assert.deepEqual(parseRoutes([]), []);
});

test('refresh fetches each safe host once in lowercase and stores per-host routes', async () => {
  const storage = memoryStorage();
  const requested = [];
  const store = createRouteStore({
    storage,
    now: () => '2026-11-06T00:00:00.000Z',
    fetchRoutes: async (host) => {
      requested.push(host);
      return [entry('u', '/u/')];
    },
  });
  const snapshot = await store.refresh(['QOUK4442-U.dedalus.lan', 'qouk4442-u.dedalus.lan', 'bad_host.example', 'other.example']);
  assert.deepEqual(requested.sort(), ['other.example', 'qouk4442-u.dedalus.lan']);
  assert.deepEqual({ ...snapshot }, {
    'other.example': { routes: [{ component: 'u', path: '/u/', port: 443 }], fetchedAt: '2026-11-06T00:00:00.000Z' },
    'qouk4442-u.dedalus.lan': { routes: [{ component: 'u', path: '/u/', port: 443 }], fetchedAt: '2026-11-06T00:00:00.000Z' },
  });
});

test('a failed host keeps its last routes and date with the error, and an empty success clears routes', async () => {
  const storage = memoryStorage();
  let mode = 'ok';
  const store = createRouteStore({
    storage,
    now: () => (mode === 'ok' ? '2026-11-06T00:00:00.000Z' : '2026-11-07T00:00:00.000Z'),
    fetchRoutes: async (host) => {
      if (host === 'a.example' && mode === 'fail') throw new Error('Routes unavailable (HTTP 503).');
      if (host === 'a.example' && mode === 'empty') return [];
      return [entry('u', '/u/')];
    },
  });
  await store.refresh(['a.example', 'b.example']);
  mode = 'fail';
  const failed = await store.refresh(['a.example', 'b.example']);
  assert.deepEqual(failed['a.example'], {
    routes: [{ component: 'u', path: '/u/', port: 443 }],
    fetchedAt: '2026-11-06T00:00:00.000Z',
    error: 'Routes unavailable (HTTP 503).',
  });
  assert.equal(failed['b.example'].error, undefined);
  mode = 'empty';
  const cleared = await store.refresh(['a.example']);
  assert.deepEqual({ ...cleared }, { 'a.example': { routes: [], fetchedAt: '2026-11-07T00:00:00.000Z' } });
});

test('a host that fails before any success reports empty routes, no date, and the error', async () => {
  const store = createRouteStore({
    storage: memoryStorage(),
    fetchRoutes: async () => { throw new Error('Routes unavailable (HTTP 404).'); },
  });
  const snapshot = await store.refresh(['a.example']);
  assert.deepEqual(snapshot['a.example'], {
    routes: [], fetchedAt: null, error: 'Routes unavailable (HTTP 404).',
  });
});

test('an invalid document is a host failure that retains the previous routes', async () => {
  const storage = memoryStorage();
  let invalid = false;
  const store = createRouteStore({
    storage,
    fetchRoutes: async () => (invalid ? { routes: [] } : [entry('u', '/u/')]),
  });
  await store.refresh(['a.example']);
  invalid = true;
  const snapshot = await store.refresh(['a.example']);
  assert.deepEqual(snapshot['a.example'].routes, [{ component: 'u', path: '/u/', port: 443 }]);
  assert.match(snapshot['a.example'].error, /expected a JSON array/);
});

test('hosts that leave the inventory are removed from the snapshot', async () => {
  const store = createRouteStore({ storage: memoryStorage(), fetchRoutes: async () => [entry('u', '/u/')] });
  await store.refresh(['a.example', 'b.example']);
  const snapshot = await store.refresh(['b.example']);
  assert.deepEqual(Object.keys(snapshot), ['b.example']);
});

test('host names that match Object prototype members are plain own entries only', async () => {
  const store = createRouteStore({ storage: memoryStorage(), fetchRoutes: async () => [] });
  const snapshot = await store.refresh(['constructor', 'ToString']);
  assert.deepEqual(Object.keys(snapshot).sort(), ['constructor', 'tostring']);
  assert.deepEqual(snapshot.constructor.routes, []);
  assert.equal(snapshot.valueOf, undefined);
  assert.equal(snapshot.hasOwnProperty, undefined);
});

test('a restarted store restores persisted routes without fetching', async () => {
  const storage = memoryStorage();
  const store = createRouteStore({ storage, fetchRoutes: async () => [entry('iris', '/u/iris/', 9443)] });
  const saved = await store.refresh(['a.example']);
  let fetches = 0;
  const restarted = createRouteStore({ storage, fetchRoutes: async () => { fetches += 1; throw new Error('Offline'); } });
  assert.deepEqual(await restarted.getSnapshot(), saved);
  assert.equal(fetches, 0);
});

test('persisted routes are revalidated so unsafe stored entries never reach the snapshot', async () => {
  const storage = memoryStorage();
  await storage.set({
    proxyRoutes: {
      version: 1,
      hosts: {
        'a.example': {
          routes: [
            { component: 'u', path: '/u/', port: 443 },
            { component: 'evil', path: 'https://evil.example/', port: 443 },
          ],
          fetchedAt: '2026-11-06T00:00:00.000Z',
        },
      },
    },
  });
  const store = createRouteStore({ storage, fetchRoutes: async () => [] });
  assert.deepEqual((await store.getSnapshot())['a.example'].routes, [{ component: 'u', path: '/u/', port: 443 }]);
});

test('a storage failure rejects the refresh and keeps the working in-memory snapshot', async () => {
  const storage = memoryStorage();
  let mode = 'ok';
  const store = createRouteStore({
    now: () => '2026-11-06T00:00:00.000Z',
    storage,
    fetchRoutes: async () => (mode === 'ok' ? [entry('u', '/u/')] : [entry('iris', '/u/iris/')]),
  });
  const before = await store.refresh(['a.example']);
  storage.fail = true;
  mode = 'changed';
  await assert.rejects(store.refresh(['a.example']), /Storage quota exceeded/);
  assert.deepEqual(await store.getSnapshot(), before);
  storage.fail = false;
  assert.deepEqual({ ...await store.refresh(['a.example']) }, {
    'a.example': { routes: [{ component: 'iris', path: '/u/iris/', port: 443 }], fetchedAt: before['a.example'].fetchedAt },
  });
});

test('identical concurrent refreshes coalesce into one fetch per host', async () => {
  let fetches = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const store = createRouteStore({
    storage: memoryStorage(),
    fetchRoutes: async () => { fetches += 1; await gate; return [entry('u', '/u/')]; },
  });
  const first = store.refresh(['a.example']);
  const second = store.refresh(['A.example']);
  release();
  assert.deepEqual(await first, await second);
  assert.equal(fetches, 1);
});

test('host fetches run with at most 16 in flight', async () => {
  let active = 0;
  let peak = 0;
  let release;
  let signalStarted;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { signalStarted = resolve; });
  const hosts = Array.from({ length: 40 }, (_, index) => `host${index}.example`);
  const store = createRouteStore({
    storage: memoryStorage(),
    fetchRoutes: async () => {
      active += 1;
      peak = Math.max(peak, active);
      if (active === 16) signalStarted();
      await gate;
      active -= 1;
      return [];
    },
  });
  const pending = store.refresh(hosts);
  await started;
  assert.equal(active, 16);
  release();
  await pending;
  assert.equal(peak, 16);
});
