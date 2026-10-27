import { SOURCES, parseEnvironments } from './catalog.js';

const CACHE_KEY = 'catalog';
const CACHE_VERSION = 2;

export function catalogStatus(snapshot) {
  return {
    count: snapshot.sources.reduce((count, source) => count + source.records.length, 0),
    fetchedAt: snapshot.fetchedAt,
    bundled: snapshot.bundled,
    sources: snapshot.sources.map(({ id, label, url, updatedAt, records }) => ({
      id, label, url, updatedAt, count: records.length,
    })),
  };
}

// One storage value makes the two-source replacement atomic to readers.
export function createCatalogStore({ storage, fetchXml, now = () => new Date().toISOString() }) {
  let snapshot;
  let loading;
  let refreshing;

  async function buildSnapshot(bundled) {
    const sources = await Promise.all(SOURCES.map(async (source) => {
      let xml;
      try {
        xml = await fetchXml(source, bundled);
        const parsed = parseEnvironments(xml, source.id);
        return { ...source, xml, ...parsed };
      } catch (error) {
        throw new Error(`${source.label}: ${error.message}`);
      }
    }));
    return { version: CACHE_VERSION, fetchedAt: now(), bundled, sources };
  }

  async function getSnapshot() {
    if (snapshot) return snapshot;
    if (!loading) {
      loading = (async () => {
        const saved = (await storage.get(CACHE_KEY))[CACHE_KEY];
        if ((saved?.version === CACHE_VERSION || saved?.version === 1) && saved.sources?.length === SOURCES.length &&
            SOURCES.every(({ id }) => saved.sources.some(source => source.id === id &&
              typeof source.xml === 'string' && Array.isArray(source.records)))) {
          if (saved.version === 1) {
            // Re-index the user's saved XML, preserving downloaded data and its dates.
            const migrated = {
              ...saved,
              version: CACHE_VERSION,
              sources: saved.sources.map(source => ({ ...source, ...parseEnvironments(source.xml, source.id) })),
            };
            await storage.set({ [CACHE_KEY]: migrated });
            snapshot = migrated;
          } else {
            snapshot = saved;
          }
        } else {
          const bundled = await buildSnapshot(true);
          await storage.set({ [CACHE_KEY]: bundled });
          snapshot = bundled;
        }
        return snapshot;
      })().finally(() => { loading = undefined; });
    }
    return loading;
  }

  async function refresh() {
    if (!refreshing) {
      refreshing = (async () => {
        await getSnapshot();
        const replacement = await buildSnapshot(false);
        await storage.set({ [CACHE_KEY]: replacement });
        snapshot = replacement;
        return snapshot;
      })().finally(() => { refreshing = undefined; });
    }
    return refreshing;
  }

  return { getSnapshot, refresh };
}
