import test from 'node:test';
import assert from 'node:assert/strict';

// Model only Chrome/HTTP boundaries; run the real worker, catalog parser and resolver.
function event() {
  return { listener: undefined, addListener(listener) { this.listener = listener; } };
}
const onInputStarted = event();
const onInputChanged = event();
const onInputEntered = event();
const onInputCancelled = event();
let saved = {};
let description = '';
const navigations = [];
let networkFails = false;
let remoteGate;
let remoteStarted;
let failSuccessMetadata = false;
const xml = `<environments lastupdate="27.10.2026"><environment_type type="QA"><environment><region>UKI</region><db>QOUK4442</db><software_installations><software name="ORBIS PROXY"><server>QOUK4442-U.DEDALUS.LAN</server></software></software_installations></environment></environment_type></environments>`;
let remoteXml = xml;
const nativeFetch = globalThis.fetch;
globalThis.chrome = {
  storage: { local: {
    async get(key) { return { [key]: structuredClone(saved[key]) }; },
    async set(value) {
      if (failSuccessMetadata && value.refreshAttempt?.state === 'succeeded') {
        failSuccessMetadata = false;
        throw new Error('Refresh metadata unavailable');
      }
      saved = { ...saved, ...structuredClone(value) };
    },
  } },
  runtime: { onInstalled: event(), getURL: file => `chrome-extension://test/${file}` },
  omnibox: {
    onInputStarted, onInputChanged, onInputEntered, onInputCancelled,
    setDefaultSuggestion(value) { description = value.description; },
  },
  tabs: {
    async update(value) { navigations.push({ ...value, mode: 'current' }); },
    async create(value) { navigations.push({ ...value, mode: 'new' }); },
  },
};
globalThis.fetch = async url => {
  if (networkFails && url.startsWith('https:')) throw new Error('Offline');
  if (url.startsWith('https:')) {
    remoteStarted?.();
    if (remoteGate) await remoteGate;
  }
  const response = new Response(url.startsWith('https:') ? remoteXml : xml);
  Object.defineProperty(response, 'url', { value: url });
  return response;
};
await import('../src/background.js');
test.after(() => { globalThis.fetch = nativeFetch; delete globalThis.chrome; });

async function suggestions(query) {
  let results;
  await onInputChanged.listener(query, value => { results = value; });
  return results;
}

test('exact Enter opens the same endpoint shown in suggestions in the requested disposition', async () => {
  const results = await suggestions('qouk4442 iris');
  assert.equal(results[0].content, 'https://QOUK4442-U.DEDALUS.LAN/u/iris');
  await onInputEntered.listener('iris qouk4442', 'newBackgroundTab');
  assert.deepEqual(navigations.pop(), { url: results[0].content, mode: 'new', active: false });
  await onInputEntered.listener(results[0].content, 'currentTab');
  assert.deepEqual(navigations.pop(), { url: results[0].content, mode: 'current' });
});

test('unknown queries, ambiguous products and unfinished tickets never navigate or open replacement UI', async () => {
  for (const input of ['qouk4442', 'not-an-environment iris', 'bug', 'https://dedalus.atlassian.net/browse/ORBISBUG-', 'https://evil.example/']) {
    await onInputEntered.listener(input, 'currentTab');
    assert.deepEqual(navigations, [], input);
  }
  await onInputEntered.listener('bug 12345', 'currentTab');
  assert.deepEqual(navigations.pop(), { url: 'https://dedalus.atlassian.net/browse/ORBISBUG-12345', mode: 'current' });
});

test('status/help do not navigate; failed manual refresh reports failure and keeps lookup usable', async () => {
  const before = structuredClone(saved.catalog);
  networkFails = true;
  await onInputEntered.listener('refresh', 'currentTab');
  assert.equal(saved.refreshAttempt.state, 'failed');
  assert.deepEqual(saved.catalog, before);
  await suggestions('status');
  assert.match(description, /failed/);
  assert.match(description, /Offline/);
  assert.deepEqual(navigations, []);
  assert.equal((await suggestions('qouk4442 iris'))[0].content, 'https://QOUK4442-U.DEDALUS.LAN/u/iris');
  await onInputEntered.listener('help', 'currentTab');
  assert.deepEqual(navigations, []);
});

test('finishing an older refresh cannot replace a newer query description', async () => {
  networkFails = false;
  let release;
  remoteGate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { remoteStarted = resolve; });
  const pending = onInputEntered.listener('refresh', 'currentTab');
  await started;
  await suggestions('epic 777');
  const currentDescription = description;
  release();
  await pending;
  remoteGate = undefined;
  remoteStarted = undefined;
  assert.equal(description, currentDescription);
  assert.deepEqual(navigations, []);
});

test('post-commit metadata failure does not roll back the updated endpoint catalog', async () => {
  remoteXml = xml.replace('QOUK4442-U.DEDALUS.LAN', 'UPDATED-U.DEDALUS.LAN');
  failSuccessMetadata = true;
  await onInputEntered.listener('refresh', 'currentTab');
  assert.equal(saved.catalog.bundled, false);
  assert.equal((await suggestions('qouk4442 iris'))[0].content, 'https://UPDATED-U.DEDALUS.LAN/u/iris');
  assert.deepEqual(navigations, []);
});
