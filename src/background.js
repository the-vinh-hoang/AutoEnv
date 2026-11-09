import { createCatalogStore, catalogStatus } from './cache.js';
import { createRouteStore } from './routes.js';
import { suggest, isAllowedDestination } from './resolve.js';

async function readOpenCollector(url) {
  const tabs = await chrome.tabs.query({ url });
  for (const tab of tabs) {
    try {
      const [frame] = await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [0] },
        func: expectedUrl => {
          // Recheck inside the frame: it may have navigated since tabs.query.
          if (location.href !== expectedUrl || document.contentType === 'text/html') return null;
          try {
            return JSON.parse(document.querySelector('pre')?.textContent ?? document.body?.textContent ?? '');
          } catch {
            return null;
          }
        },
        args: [url],
      });
      if (Array.isArray(frame?.result)) return frame.result;
    } catch {
      // Try another matching tab if this one closed, navigated, or is still on a warning.
    }
  }
  return null;
}

const store = createCatalogStore({
  storage: chrome.storage.local,
  async fetchXml(source, bundled) {
    const url = bundled ? chrome.runtime.getURL(`data/${source.file}`) : source.url;
    const response = await fetch(url, {
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`Download failed (HTTP ${response.status}). Check company network access.`);
    return response.text();
  },
});
const routeStore = createRouteStore({
  storage: chrome.storage.local,
  async fetchRoutes(host) {
    const url = `https://${host}/u/proxy/v2/routes`;
    let response;
    try {
      response = await fetch(url, {
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });
    } catch (error) {
      // MV3 worker fetch cannot reuse certificate exceptions approved in a browser tab.
      const routes = await readOpenCollector(url);
      if (routes !== null) return routes;
      throw new Error(`${error.message} If this collector needs a certificate exception, open ${url} in this browser, verify it with your company, and leave the JSON page open while running update.`, { cause: error });
    }
    if (!response.ok) throw new Error(`Routes unavailable (HTTP ${response.status}).`);
    return response.json();
  },
});

const recordsOf = snapshot => snapshot.sources.flatMap(source => source.records);
const escapeDescription = text => String(text).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
})[character]);
const setDescription = description => chrome.omnibox.setDefaultSuggestion({ description });
const instruction = 'AutoEnv: database + product (either order), bug/story/epic + number; update, status, help';

async function statusDescription(snapshot) {
  const status = catalogStatus(snapshot);
  const [{ updateAttempt }, routes] = await Promise.all([
    chrome.storage.local.get('updateAttempt'), routeStore.getSnapshot(),
  ]);
  const hosts = [...new Set(recordsOf(snapshot).flatMap(record => record.proxyHosts).map(host => host.toLowerCase()))];
  const cached = hosts.filter(host => routes[host]?.fetchedAt).length;
  const failures = hosts.filter(host => routes[host]?.error).length;
  const sources = status.sources.map(source => `${source.label}: ${source.updatedAt}`).join('; ');
  const lastAttempt = updateAttempt
    ? `; last update ${updateAttempt.state === 'started' && !updating ? 'interrupted' : updateAttempt.state} (${updateAttempt.at})${updateAttempt.error ? `: ${updateAttempt.error}` : ''}`
    : '';
  return escapeDescription(`${status.count} environments; ${status.bundled ? 'bundled XML' : `downloaded ${status.fetchedAt}`}; ${sources}; proxy routes ${cached}/${hosts.length} hosts cached${failures ? `, ${failures} unavailable` : ''}${lastAttempt}`);
}

const commandSuggestions = [
  { content: 'update', description: 'Update — download environment catalogs and discover products from every ORBIS PROXY; cached data stays usable' },
  { content: 'status', description: 'Data status — catalog dates, proxy route coverage and the last update result' },
  { content: 'help', description: 'Usage — database + product in either order; bug/story/epic + ticket number' },
];

let inputSequence = 0;
let updating;
chrome.omnibox.onInputStarted.addListener(() => {
  inputSequence++;
  setDescription('Update AutoEnv data — press Enter, or type a database + product; status, help');
});
chrome.omnibox.onInputCancelled.addListener(() => { inputSequence++; });
chrome.omnibox.onInputChanged.addListener((query, sendSuggestions) => {
  const sequence = ++inputSequence;
  return (async () => {
    const command = query.trim().toLowerCase();
    const snapshot = await store.getSnapshot();
    let description;
    let suggestions;
    if (command === 'status') {
      description = await statusDescription(snapshot);
      suggestions = commandSuggestions.filter(item => item.content !== 'status');
    } else if (command === 'update') {
      description = 'Update catalogs and proxy routes — press Enter; cached data remains usable. Type ae + Tab + status afterward for the result.';
      suggestions = [];
    } else if (command === 'help' || !command) {
      description = command ? instruction : 'Update AutoEnv data — press Enter, or type a database + product; status, help';
      suggestions = commandSuggestions;
    } else {
      const routes = await routeStore.getSnapshot();
      const matches = suggest(query, recordsOf(snapshot), 7, routes);
      if (matches.length === 1 && matches[0].kind !== 'jira-prefix') {
        description = `${escapeDescription(matches[0].title)} — <url>${escapeDescription(matches[0].url)}</url>`;
      } else if (matches[0]?.kind === 'jira-prefix') {
        description = `Add a numeric ticket ID, e.g. <match>${escapeDescription(command)} 12345</match> — <url>${escapeDescription(matches[0].url)}</url>`;
      } else {
        description = matches.length ? 'AutoEnv: choose a suggestion with the arrow keys, then Enter'
          : updating ? 'AutoEnv: updating catalogs and proxy routes; cached matches remain available. Try again shortly or type status.'
          : 'AutoEnv: no matching endpoint. Check database/product; run update to discover proxy products, or type status.';
      }
      suggestions = matches.map(match => ({
        content: match.completion,
        description: `${escapeDescription(match.title)} — <dim>${escapeDescription(match.description)}</dim> <url>${escapeDescription(match.url)}</url>`,
      }));
      if (!matches.length) suggestions = commandSuggestions.filter(item => item.content.startsWith(command));
    }
    if (sequence !== inputSequence) return;
    await setDescription(description);
    if (sequence !== inputSequence) return;
    sendSuggestions(suggestions);
  })().catch(async error => {
    if (sequence !== inputSequence) return;
    await setDescription(`AutoEnv: ${escapeDescription(error.message)}`);
    if (sequence !== inputSequence) return;
    sendSuggestions([]);
  });
});

async function navigate(url, disposition) {
  if (disposition === 'currentTab') await chrome.tabs.update({ url });
  else await chrome.tabs.create({ url, active: disposition !== 'newBackgroundTab' });
}

async function performUpdate() {
  const at = new Date().toISOString();
  await chrome.storage.local.set({ updateAttempt: { state: 'started', at } });
  let snapshot;
  let routes;
  let catalogError;
  try {
    snapshot = await store.getSnapshot();
    try {
      snapshot = await store.refresh();
    } catch (error) {
      catalogError = `Catalog update failed; using cached XML: ${error.message}`;
    }
    routes = await routeStore.refresh(recordsOf(snapshot).flatMap(record => record.proxyHosts));
  } catch (error) {
    await chrome.storage.local.set({ updateAttempt: { state: 'failed', at, error: error.message } });
    throw error;
  }
  const failures = Object.values(routes).filter(entry => entry.error).length;
  const errors = [catalogError, failures ? `${failures} proxy hosts unavailable; last successful routes retained where available` : undefined].filter(Boolean);
  const attempt = {
    state: catalogError ? 'failed' : failures ? 'partial' : 'succeeded', at,
    ...(errors.length ? { error: errors.join('; ') } : {}),
  };
  try {
    await chrome.storage.local.set({ updateAttempt: attempt });
    return { snapshot };
  } catch (error) {
    return { snapshot, metadataError: error.message };
  }
}

async function updateData(sequence) {
  if (!updating) updating = performUpdate().finally(() => { updating = undefined; });
  try {
    const { snapshot, metadataError } = await updating;
    if (sequence === undefined || sequence !== inputSequence) return;
    const description = metadataError
      ? `AutoEnv: data updated; update status unavailable. ${escapeDescription(metadataError)}`
      : await statusDescription(snapshot);
    if (sequence === inputSequence) await setDescription(description);
  } catch (error) {
    if (sequence === undefined) console.error('AutoEnv automatic update failed; cached data remains usable:', error);
    else if (sequence === inputSequence) await setDescription(`AutoEnv: update failed; cached data remains usable. ${escapeDescription(error.message)}`);
  }
}

// Browser startup and extension installation/reload, not every service-worker wake.
chrome.runtime.onInstalled.addListener(() => updateData());
chrome.runtime.onStartup.addListener(() => updateData());

chrome.omnibox.onInputEntered.addListener((input, disposition) => {
  const sequence = ++inputSequence;
  return (async () => {
    const command = input.trim().toLowerCase();
    if (command === 'update' || !command) return updateData(sequence);
    const snapshot = await store.getSnapshot();
    if (command === 'status') {
      const description = await statusDescription(snapshot);
      if (sequence === inputSequence) return setDescription(description);
      return;
    }
    if (command === 'help') {
      if (sequence === inputSequence) return setDescription(instruction);
      return;
    }
    const records = recordsOf(snapshot);
    const routes = await routeStore.getSnapshot();
    if (isAllowedDestination(input, records, routes)) return navigate(input, disposition);
    const matches = suggest(input, records, 30, routes);
    if (matches.length === 1 && matches[0].kind !== 'jira-prefix') {
      return navigate(matches[0].url, disposition);
    }
    // Never open a popup, unfinished ticket, guessed endpoint or external search.
    if (sequence !== inputSequence) return;
    setDescription(matches[0]?.kind === 'jira-prefix'
      ? 'AutoEnv: add a numeric ticket ID before Enter, e.g. bug 12345'
      : 'AutoEnv: select one of the matching suggestions before Enter');
  })().catch(error => {
    console.error('AutoEnv command failed:', error);
    if (sequence !== inputSequence) return;
    setDescription(`AutoEnv: ${escapeDescription(error.message)}`);
  });
});
