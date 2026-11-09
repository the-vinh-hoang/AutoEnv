import { isSafeHostname } from './catalog.js';

const ROUTES_KEY = 'proxyRoutes';
const ROUTES_VERSION = 1;
const CONCURRENCY = 16;
const MAX_PATH_LENGTH = 2048;
const ROUTE_BASE = 'https://route.invalid';

const COMPONENT = /^[^\s\u0000-\u001f\u007f]+$/;
const PORT = /^[1-9]\d{0,4}$/;
// Characters that change how a path is split or read: whitespace, backslash, query/fragment delimiters, controls.
const UNSAFE_PATH_CHAR = /[\s\\?#\u0000-\u001f\u007f]/;
// Percent-escapes that decode to a separator, dot, backslash, or control character.
const HAZARDOUS_ESCAPE = /%(?:2e|2f|5c|[01][0-9a-f]|7f)/i;
const MALFORMED_ESCAPE = /%(?![0-9a-f]{2})/i;

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeComponent(value) {
  if (typeof value !== 'string') return null;
  const component = value.trim();
  return COMPONENT.test(component) ? component : null;
}

function safePath(value) {
  if (typeof value !== 'string' || value.length > MAX_PATH_LENGTH) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (UNSAFE_PATH_CHAR.test(value) || HAZARDOUS_ESCAPE.test(value) || MALFORMED_ESCAPE.test(value)) return null;
  try {
    // A path the URL parser rewrites (dot segments, non-ASCII, reserved characters) is not the path the proxy published.
    return new URL(value, ROUTE_BASE).pathname === value ? value : null;
  } catch {
    return null;
  }
}

function safePort(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const text = String(value).trim();
  if (!PORT.test(text)) return null;
  const port = Number(text);
  return port <= 65535 ? port : null;
}

function safeRoute(component, path, port) {
  const safe = { component: safeComponent(component), path: safePath(path), port: safePort(port) };
  return safe.component !== null && safe.path !== null && safe.port !== null ? safe : null;
}

function unique(routes) {
  const seen = new Set();
  return routes.filter((route) => {
    const key = `${route.component}\n${route.path}\n${route.port}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Accepts the collector's array shape; entries that cannot be used are skipped, not failed.
export function parseRoutes(json) {
  if (!Array.isArray(json)) throw new Error('Invalid route document: expected a JSON array');
  const routes = [];
  for (const entry of json) {
    if (!isObject(entry)) continue;
    const route = safeRoute(entry.component, entry['proxy-location'], entry['proxy-port']);
    if (route) routes.push(route);
  }
  return unique(routes);
}

// Re-validates persisted entries so corrupted storage cannot inject unsafe routes.
function restoreHost(record) {
  if (!isObject(record) || !Array.isArray(record.routes)) return null;
  const routes = unique(record.routes.flatMap((route) => {
    if (!isObject(route)) return [];
    const safe = safeRoute(route.component, route.path, route.port);
    return safe ? [safe] : [];
  }));
  return {
    routes,
    fetchedAt: typeof record.fetchedAt === 'string' ? record.fetchedAt : null,
    ...(typeof record.error === 'string' ? { error: record.error } : {}),
  };
}

function restoreSnapshot(saved) {
  const snapshot = Object.create(null);
  if (saved?.version !== ROUTES_VERSION || !isObject(saved.hosts)) return snapshot;
  for (const [host, record] of Object.entries(saved.hosts)) {
    const restored = isSafeHostname(host) ? restoreHost(record) : null;
    if (restored) snapshot[host] = restored;
  }
  return snapshot;
}

function normalizeInventory(hosts) {
  const seen = new Set();
  for (const host of hosts) {
    if (typeof host !== 'string') continue;
    const normalized = host.trim().toLowerCase();
    if (isSafeHostname(normalized)) seen.add(normalized);
  }
  return [...seen].sort();
}

// Per-host results: one entry per requested host. Failures keep the last successful routes and date.
export function createRouteStore({ storage, fetchRoutes, now = () => new Date().toISOString() }) {
  let snapshot;
  let loading;
  let pending;
  let queue = Promise.resolve();

  async function load() {
    if (snapshot) return snapshot;
    if (!loading) {
      loading = (async () => {
        const saved = (await storage.get(ROUTES_KEY))[ROUTES_KEY];
        snapshot = restoreSnapshot(saved);
        return snapshot;
      })().finally(() => { loading = undefined; });
    }
    return loading;
  }

  async function fetchHost(host, previous) {
    try {
      const routes = parseRoutes(await fetchRoutes(host));
      return { routes, fetchedAt: now() };
    } catch (error) {
      const message = error?.message ?? String(error);
      return {
        routes: previous?.routes ?? [],
        fetchedAt: previous?.fetchedAt ?? null,
        error: message,
      };
    }
  }

  async function fetchAll(inventory, previous) {
    const results = new Map();
    let next = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, inventory.length) }, async () => {
      while (next < inventory.length) {
        const host = inventory[next++];
        results.set(host, await fetchHost(host, previous[host]));
      }
    });
    await Promise.all(workers);
    const replacement = Object.create(null);
    for (const host of inventory) replacement[host] = results.get(host);
    return replacement;
  }

  async function update(inventory) {
    const current = await load();
    const replacement = await fetchAll(inventory, current);
    // Publish only after persistence succeeds, so readers never see routes that would be lost on restart.
    await storage.set({ [ROUTES_KEY]: { version: ROUTES_VERSION, hosts: replacement } });
    snapshot = replacement;
    return snapshot;
  }

  async function getSnapshot() {
    return load();
  }

  function refresh(hosts) {
    const inventory = normalizeInventory(hosts);
    const key = inventory.join('\n');
    if (pending?.key === key) return pending.promise;
    // Different inventories wait for the in-flight refresh so they never interleave their writes.
    const run = queue.then(() => update(inventory));
    const entry = { key, promise: run };
    pending = entry;
    queue = run.then(() => {}, () => {});
    const clear = () => { if (pending === entry) pending = undefined; };
    run.then(clear, clear);
    return run;
  }

  return { getSnapshot, refresh };
}
