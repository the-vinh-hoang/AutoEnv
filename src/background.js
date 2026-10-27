import { createCatalogStore, catalogStatus } from './cache.js';
import { suggest, isAllowedDestination } from './resolve.js';

const store = createCatalogStore({
  storage: chrome.storage.local,
  async fetchXml(source, bundled) {
    const url = bundled ? chrome.runtime.getURL(`data/${source.file}`) : source.url;
    const response = await fetch(url, {
      cache: 'no-store',
      credentials: 'omit',
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`Download failed (HTTP ${response.status}). Check company network access.`);
    if (!bundled && response.url !== source.url) throw new Error('The XML source redirected. Check company network access.');
    return response.text();
  },
});

const recordsOf = snapshot => snapshot.sources.flatMap(source => source.records);
const escapeDescription = text => String(text).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
})[character]);
const setDescription = description => chrome.omnibox.setDefaultSuggestion({ description });
const instruction = 'AutoEnv: database + product (either order), bug/story/epic + number; refresh, status, help';

chrome.runtime.onInstalled.addListener(() => {
  store.getSnapshot().catch(error => console.error('AutoEnv catalog initialization failed:', error));
});

async function statusDescription(snapshot) {
  const status = catalogStatus(snapshot);
  const { refreshAttempt } = await chrome.storage.local.get('refreshAttempt');
  const sources = status.sources.map(source => `${source.label}: ${source.updatedAt}`).join('; ');
  const lastAttempt = refreshAttempt
    ? `; last refresh ${refreshAttempt.state} (${refreshAttempt.at})${refreshAttempt.error ? `: ${refreshAttempt.error}` : ''}`
    : '';
  return escapeDescription(`${status.count} environments; ${status.bundled ? 'bundled XML' : `downloaded ${status.fetchedAt}`}; ${sources}${lastAttempt}`);
}

const commandSuggestions = [
  { content: 'refresh', description: 'Refresh XML — press Enter to download both catalogs; then type ae + Tab + status for the result' },
  { content: 'status', description: 'Catalog status — dates, environment count and the last refresh result' },
  { content: 'help', description: 'Usage — database + product in either order; bug/story/epic + ticket number' },
];

let inputSequence = 0;
chrome.omnibox.onInputStarted.addListener(() => {
  inputSequence++;
  setDescription(instruction);
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
    } else if (command === 'refresh') {
      description = 'Refresh XML — press Enter; existing data remains usable. Type ae + Tab + status afterward for the result.';
      suggestions = [];
    } else if (command === 'help' || !command) {
      description = instruction;
      suggestions = commandSuggestions;
    } else {
      const matches = suggest(query, recordsOf(snapshot), 7);
      if (matches.length === 1 && matches[0].kind !== 'jira-prefix') {
        description = `${escapeDescription(matches[0].title)} — <url>${escapeDescription(matches[0].url)}</url>`;
      } else if (matches[0]?.kind === 'jira-prefix') {
        description = `Add a numeric ticket ID, e.g. <match>${escapeDescription(command)} 12345</match> — <url>${escapeDescription(matches[0].url)}</url>`;
      } else {
        description = matches.length ? 'AutoEnv: choose a suggestion with the arrow keys, then Enter' : 'AutoEnv: no matching endpoint. Check database/product; type help for commands.';
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

async function refreshCatalog(sequence) {
  const at = new Date().toISOString();
  await chrome.storage.local.set({ refreshAttempt: { state: 'started', at } });
  let snapshot;
  try {
    snapshot = await store.refresh();
  } catch (error) {
    await chrome.storage.local.set({ refreshAttempt: { state: 'failed', at, error: error.message } });
    if (sequence === inputSequence) {
      return setDescription(`AutoEnv: refresh failed; previous catalog retained. ${escapeDescription(error.message)}`);
    }
    return;
  }
  try {
    await chrome.storage.local.set({ refreshAttempt: { state: 'succeeded', at } });
    if (sequence !== inputSequence) return;
    const description = await statusDescription(snapshot);
    if (sequence === inputSequence) await setDescription(description);
  } catch (error) {
    if (sequence === inputSequence) {
      return setDescription(`AutoEnv: catalog updated; refresh status unavailable. ${escapeDescription(error.message)}`);
    }
  }
}

chrome.omnibox.onInputEntered.addListener((input, disposition) => {
  const sequence = ++inputSequence;
  return (async () => {
    const command = input.trim().toLowerCase();
    if (command === 'refresh') return refreshCatalog(sequence);
    const snapshot = await store.getSnapshot();
    if (command === 'status') {
      const description = await statusDescription(snapshot);
      if (sequence === inputSequence) return setDescription(description);
      return;
    }
    if (command === 'help' || !command) {
      if (sequence === inputSequence) return setDescription(instruction);
      return;
    }
    const records = recordsOf(snapshot);
    if (isAllowedDestination(input, records)) return navigate(input, disposition);
    const matches = suggest(input, records);
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
