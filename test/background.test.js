import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';

// Model only Chrome/HTTP boundaries; run the real worker, parsers, stores and resolver.
function event() {
  return { listener: undefined, addListener(listener) { this.listener = listener; } };
}
const xml = `<environments lastupdate="27.10.2026"><environment_type type="QA"><environment><region>UKI</region><db>QOUK4442</db><software_installations><software name="ORBIS PROXY"><server>QOUK4442-U.DEDALUS.LAN</server></software></software_installations></environment></environment_type></environments>`;
const routes = [
  { component: 'iris', 'proxy-location': '/u/iris/', 'proxy-port': '443' },
  { component: 'iris-tracing', 'proxy-location': '/u/iris-tracing/', 'proxy-port': '443' },
  { component: 'new-product', 'proxy-location': '/products/new/', 'proxy-port': '9443' },
];
const nativeFetch = globalThis.fetch;
let instance = 0;
test.afterEach(() => { globalThis.fetch = nativeFetch; delete globalThis.chrome; });

async function worker() {
  const state = {
    saved: {}, description: '', navigations: [], networkFails: false, routesFail: false, catalogFails: false,
    remoteXml: xml, remoteRoutes: routes, remoteGate: undefined, remoteStarted: undefined,
    failSuccessMetadata: false,
    collectorTabs: [],
  };
  const onInputStarted = event();
  const onInputChanged = event();
  const onInputEntered = event();
  const onInputCancelled = event();
  const onInstalled = event();
  const onStartup = event();
  globalThis.chrome = {
    storage: { local: {
      async get(key) { return { [key]: structuredClone(state.saved[key]) }; },
      async set(value) {
        if (state.failSuccessMetadata && value.updateAttempt?.state === 'succeeded') {
          state.failSuccessMetadata = false;
          throw new Error('Update metadata unavailable');
        }
        state.saved = { ...state.saved, ...structuredClone(value) };
      },
    } },
    runtime: { onInstalled, onStartup, getURL: file => `chrome-extension://test/${file}` },
    omnibox: {
      onInputStarted, onInputChanged, onInputEntered, onInputCancelled,
      setDefaultSuggestion(value) { state.description = value.description; },
    },
    tabs: {
      async query({ url }) { return state.collectorTabs.filter(tab => tab.url === url).map(({ id, url }) => ({ id, url })); },
      async update(value) { state.navigations.push({ ...value, mode: 'current' }); },
      async create(value) { state.navigations.push({ ...value, mode: 'new' }); },
    },
    scripting: {
      async executeScript({ target, func, args }) {
        const tab = state.collectorTabs.find(tab => tab.id === target.tabId);
        if (tab.blocked) throw new Error('Cannot access a certificate warning');
        const result = runInNewContext(`(${func})(...args)`, {
          args,
          location: { href: tab.currentUrl ?? tab.url },
          document: {
            contentType: tab.contentType ?? 'application/json',
            querySelector: () => ({ textContent: tab.text }),
            body: { textContent: tab.text },
          },
        });
        return [{ frameId: 0, result }];
      },
    },
  };
  globalThis.fetch = async url => {
    if (state.networkFails && url.startsWith('https:')) throw new Error('Offline');
    if (state.catalogFails && url.startsWith('https:') && url.endsWith('.xml')) throw new Error('Catalog offline');
    if (url.startsWith('https:')) {
      state.remoteStarted?.();
      if (state.remoteGate) await state.remoteGate;
    }
    if (url.endsWith('/u/proxy/v2/routes')) {
      if (state.routesFail) throw new Error('Proxy offline');
      return Response.json(state.remoteRoutes);
    }
    return new Response(url.startsWith('https:') ? state.remoteXml : xml);
  };
  await import(`../src/background.js?worker=${++instance}`);
  return {
    state, onInstalled, onStartup,
    async suggestions(query) {
      let results;
      await onInputChanged.listener(query, value => { results = value; });
      return results;
    },
    enter: (input, disposition = 'currentTab') => onInputEntered.listener(input, disposition),
  };
}

test('install and browser startup discover products automatically without opening a page', async () => {
  const { state, onInstalled, onStartup, suggestions } = await worker();
  await onInstalled.listener();
  assert.equal((await suggestions('qouk4442 new-product'))[0].content,
    'https://QOUK4442-U.DEDALUS.LAN:9443/products/new/');
  state.remoteRoutes = [{ component: 'replacement', 'proxy-location': '/replacement/', 'proxy-port': 443 }];
  await onStartup.listener();
  assert.deepEqual(await suggestions('qouk4442 new-product'), []);
  assert.equal((await suggestions('replacement qouk4442'))[0].content,
    'https://QOUK4442-U.DEDALUS.LAN/replacement/');
  assert.equal(state.saved.updateAttempt.state, 'succeeded');
  assert.deepEqual(state.navigations, []);
});

test('empty ae query offers update first and Enter refreshes actual route suggestions', async () => {
  const { state, suggestions, enter } = await worker();
  assert.equal((await suggestions(''))[0].content, 'update');
  await enter('');
  assert.equal((await suggestions('qouk4442 new-product'))[0].content,
    'https://QOUK4442-U.DEDALUS.LAN:9443/products/new/');
  assert.deepEqual(state.navigations, []);
});

test('exact Enter opens the discovered endpoint shown in suggestions in the requested disposition', async () => {
  const { state, onInstalled, suggestions, enter } = await worker();
  await onInstalled.listener();
  const results = await suggestions('qouk4442 iris');
  assert.equal(results[0].content, 'https://QOUK4442-U.DEDALUS.LAN/u/iris/');
  await enter('iris qouk4442', 'newBackgroundTab');
  assert.deepEqual(state.navigations.pop(), { url: results[0].content, mode: 'new', active: false });
  await enter(results[0].content);
  assert.deepEqual(state.navigations.pop(), { url: results[0].content, mode: 'current' });
});

test('unknown queries, ambiguous products and unfinished tickets never navigate or open replacement UI', async () => {
  const { state, onInstalled, enter } = await worker();
  await onInstalled.listener();
  for (const input of ['qouk4442', 'not-an-environment iris', 'bug', 'https://dedalus.atlassian.net/browse/ORBISBUG-', 'https://evil.example/']) {
    await enter(input);
    assert.deepEqual(state.navigations, [], input);
  }
  await enter('bug 12345');
  assert.deepEqual(state.navigations.pop(), { url: 'https://dedalus.atlassian.net/browse/ORBISBUG-12345', mode: 'current' });
});

test('failed XML update reports failure and keeps cached lookup usable', async () => {
  const { state, onInstalled, suggestions, enter } = await worker();
  await onInstalled.listener();
  const before = structuredClone(state.saved);
  state.networkFails = true;
  await enter('update');
  assert.equal(state.saved.updateAttempt.state, 'failed');
  assert.deepEqual(state.saved.catalog, before.catalog);
  await suggestions('status');
  assert.match(state.description, /failed/);
  assert.match(state.description, /Offline/);
  assert.equal((await suggestions('qouk4442 iris'))[0].content, 'https://QOUK4442-U.DEDALUS.LAN/u/iris/');
  await enter('help');
  assert.deepEqual(state.navigations, []);
});

test('unavailable proxy retains routes and exposes partial update instead of inventing endpoints', async () => {
  const { state, onInstalled, suggestions, enter } = await worker();
  await onInstalled.listener();
  state.routesFail = true;
  await enter('update');
  assert.equal(state.saved.updateAttempt.state, 'partial');
  await suggestions('status');
  assert.match(state.description, /1 unavailable/);
  assert.equal((await suggestions('qouk4442 new-product'))[0].content,
    'https://QOUK4442-U.DEDALUS.LAN:9443/products/new/');
});

test('finishing an older update cannot replace a newer query description; cached lookup stays usable', async () => {
  const { state, onInstalled, suggestions, enter } = await worker();
  await onInstalled.listener();
  let release;
  state.remoteGate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { state.remoteStarted = resolve; });
  const pending = enter('update');
  await started;
  assert.equal((await suggestions('qouk4442 new-product'))[0].content,
    'https://QOUK4442-U.DEDALUS.LAN:9443/products/new/');
  await suggestions('epic 777');
  const currentDescription = state.description;
  release();
  await pending;
  assert.equal(state.description, currentDescription);
  assert.deepEqual(state.navigations, []);
});

test('post-commit metadata failure does not roll back updated endpoint data', async () => {
  const { state, onInstalled, suggestions, enter } = await worker();
  await onInstalled.listener();
  state.remoteXml = xml.replace('QOUK4442-U.DEDALUS.LAN', 'UPDATED-U.DEDALUS.LAN');
  state.failSuccessMetadata = true;
  await enter('update');
  assert.match(state.description, /data updated; update status unavailable/);
  assert.equal((await suggestions('qouk4442 iris'))[0].content, 'https://UPDATED-U.DEDALUS.LAN/u/iris/');
  assert.deepEqual(state.navigations, []);
});

test('catalog download failure still discovers reachable proxy products from bundled inventory', async () => {
  const { state, onInstalled, suggestions } = await worker();
  state.catalogFails = true;
  await onInstalled.listener();
  assert.equal(state.saved.catalog.bundled, true);
  assert.equal(state.saved.updateAttempt.state, 'failed');
  assert.match(state.saved.updateAttempt.error, /Catalog offline/);
  assert.equal((await suggestions('qouk4442 new-product'))[0].content,
    'https://QOUK4442-U.DEDALUS.LAN:9443/products/new/');
});

test('a stopped worker update is reported as interrupted rather than still running', async () => {
  const { state, suggestions } = await worker();
  state.saved.updateAttempt = { state: 'started', at: '2026-11-06T00:00:00.000Z' };
  await suggestions('status');
  assert.match(state.description, /last update interrupted/);
});

test('a browser-approved collector page supplies routes when worker fetch fails; closing it keeps cached lookup', async () => {
  const { state, onInstalled, suggestions, enter } = await worker();
  state.routesFail = true;
  state.collectorTabs = [{
    id: 1, url: 'https://qouk4442-u.dedalus.lan/u/proxy/v2/routes',
    text: JSON.stringify([{ component: 'pas', 'proxy-location': '/u/pas/', 'proxy-port': '443' }]),
  }];
  await onInstalled.listener();
  assert.equal((await suggestions('qouk4442 pas'))[0].content, 'https://QOUK4442-U.DEDALUS.LAN/u/pas/');
  assert.equal(state.saved.updateAttempt.state, 'succeeded');
  state.collectorTabs = [];
  await enter('update');
  assert.equal(state.saved.updateAttempt.state, 'partial');
  assert.equal((await suggestions('qouk4442 pas'))[0].content, 'https://QOUK4442-U.DEDALUS.LAN/u/pas/');
  assert.deepEqual(state.navigations, []);
});

test('another host, a navigated tab, warning, HTML or malformed JSON cannot replace cached routes', async () => {
  const { state, onInstalled, suggestions, enter } = await worker();
  await onInstalled.listener();
  state.routesFail = true;
  const url = 'https://qouk4442-u.dedalus.lan/u/proxy/v2/routes';
  for (const tab of [
    { url: 'https://another-u.dedalus.lan/u/proxy/v2/routes', text: '[]' },
    { url, currentUrl: 'https://qouk4442-u.dedalus.lan/login', text: '[]' },
    { url, blocked: true, text: '[]' },
    { url, contentType: 'text/html', text: '[]' },
    { url, text: 'not JSON' },
    { url, text: '{"error":"access denied"}' },
  ]) {
    state.collectorTabs = [{ id: 1, ...tab }];
    await enter('update');
    assert.equal(state.saved.updateAttempt.state, 'partial');
    assert.equal((await suggestions('qouk4442 iris-tracing'))[0].content,
      'https://QOUK4442-U.DEDALUS.LAN/u/iris-tracing/');
  }
  assert.deepEqual(state.navigations, []);
});

test('an empty approved collector clears removed products and an unreadable tab does not hide a readable one', async () => {
  const { state, onInstalled, suggestions, enter } = await worker();
  await onInstalled.listener();
  state.routesFail = true;
  const url = 'https://qouk4442-u.dedalus.lan/u/proxy/v2/routes';
  state.collectorTabs = [{ id: 1, url, blocked: true }, { id: 2, url, text: '[]' }];
  await enter('update');
  assert.equal(state.saved.updateAttempt.state, 'succeeded');
  assert.deepEqual(await suggestions('qouk4442 iris'), []);
  assert.deepEqual(state.navigations, []);
});
