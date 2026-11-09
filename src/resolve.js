import { SOURCES } from './catalog.js';

export const JIRA_ORIGIN = 'https://dedalus.atlassian.net';
const JIRA_BROWSE = '/browse/';
const JIRA_ALIASES = new Map([
  ['bug', 'ORBISBUG'],
  ['orbisbug', 'ORBISBUG'],
  ['defect', 'ORBISBUG'],
  ['gsupport', 'GSUPPORT'],
  ['hconn', 'HCONN'],
  ['story', 'HCONN'],
  ['hepic', 'HEPIC'],
  ['epic', 'HEPIC'],
]);
const JIRA_TICKET_PATH = /^(ORBISBUG|GSUPPORT|HCONN|HEPIC)-([1-9]\d*)?$/;
const JIRA_NUMBER = /^[1-9]\d*$/;
const ENDPOINT_URL = /^https:\/\/([A-Za-z0-9.-]+)(?::(\d{1,5}))?(\/[^?#\s]*)?$/i;
const DEFAULT_PORT = 443;

const OAS = 'oasHosts';

// Fixed OAS and FHIR rules. Proxy products are not listed: they come from routes discovered per host.
const PRODUCTS = [
  { id: 'webstart', hosts: OAS, port: 8443, path: '/webstart' },
  { id: 'bpe', hosts: OAS, port: 8443, path: '/webstart' },
  { id: 'ucc', hosts: OAS, port: 8443, path: '/ucc' },
  { id: 'oas', hosts: OAS, port: 9993, path: '/console/index.html' },
  { id: 'console', hosts: OAS, port: 9993, path: '/console/index.html' },
  { id: 'fhir', hosts: 'fhirHosts', port: 9993, path: '/console/index.html' },
  { id: 'fhir-back-end', hosts: 'fhirBackEndHosts', port: 9993, path: '/console/index.html' },
];
const PRODUCT_IDS = new Set(PRODUCTS.map((product) => product.id));

function endpointUrl(host, port, path) {
  const explicit = port === DEFAULT_PORT ? '' : `:${port}`;
  return `https://${host}${explicit}${path}`;
}

// Scheme and host are case-insensitive; the path stays case-sensitive.
function canonicalEndpoint(url) {
  const match = ENDPOINT_URL.exec(url);
  if (!match || match[3] === undefined) return null;
  const port = match[2] === undefined ? '' : `:${match[2]}`;
  return `https://${match[1].toLowerCase()}${port}${match[3]}`;
}

// Route snapshots are keyed by lowercase host; catalog hosts keep their reported case.
function routesFor(routesByHost, host) {
  const entry = routesByHost?.[host.toLowerCase()];
  return Array.isArray(entry?.routes) ? entry.routes : [];
}

// The endpoint always lives on the record's own catalog host, so a route can never redirect to another host.
function routeCandidate(host, route) {
  if (typeof route?.component !== 'string' || route.component === '') return null;
  if (!Number.isInteger(route.port) || route.port < 1 || route.port > 65535) return null;
  if (typeof route.path !== 'string' || !route.path.startsWith('/')) return null;
  const url = endpointUrl(host, route.port, route.path);
  if (canonicalEndpoint(url) === null) return null;
  return { product: route.component.toLowerCase(), url };
}

// Every endpoint one record can offer: fixed OAS/FHIR rules on its hosts, plus routes discovered on its own proxy hosts.
function productCandidates(record, routesByHost) {
  const candidates = [];
  for (const product of PRODUCTS) {
    for (const host of record[product.hosts]) {
      candidates.push({ product: product.id, url: endpointUrl(host, product.port, product.path) });
    }
  }
  for (const host of record.proxyHosts) {
    for (const route of routesFor(routesByHost, host)) {
      const candidate = routeCandidate(host, route);
      if (candidate) candidates.push(candidate);
    }
  }
  return candidates;
}

function endpointKeys(records, routesByHost) {
  const keys = new Set();
  for (const record of records) {
    for (const { url } of productCandidates(record, routesByHost)) {
      keys.add(canonicalEndpoint(url));
    }
  }
  return keys;
}

function parseJiraUrl(input) {
  if (
    input.slice(0, JIRA_ORIGIN.length).toLowerCase() !== JIRA_ORIGIN ||
    !input.startsWith(JIRA_BROWSE, JIRA_ORIGIN.length)
  ) {
    return null;
  }
  const match = input.slice(JIRA_ORIGIN.length + JIRA_BROWSE.length).match(JIRA_TICKET_PATH);
  if (!match) return null;
  return { project: match[1], number: match[2] ?? null };
}

function parseJiraAlias(norm) {
  const match = norm.match(/^([a-z]+)(?:(?:\s*-\s*|\s+)(\S*))?$/);
  if (!match || !JIRA_ALIASES.has(match[1])) return null;
  const project = JIRA_ALIASES.get(match[1]);
  if (match[2] === undefined || match[2] === '') return { project, number: null };
  if (!JIRA_NUMBER.test(match[2])) return { project, invalid: true };
  return { project, number: match[2] };
}

function jiraResult(project, number) {
  const prefix = `${JIRA_ORIGIN}${JIRA_BROWSE}${project}-`;
  if (number === null) {
    return {
      kind: 'jira-prefix',
      title: `${project} ticket`,
      description: `Enter the ${project} ticket number`,
      url: prefix,
      completion: prefix,
    };
  }
  const url = `${prefix}${number}`;
  return {
    kind: 'jira',
    title: `${project}-${number}`,
    description: `Jira ticket ${project}-${number}`,
    url,
    completion: url,
  };
}

// Full catalog rows with the same source/type/region/database are labelled "row n of m".
function rowInfo(records) {
  const counts = new Map();
  const keys = new Map();
  for (const record of records) {
    const key = [record.sourceId, record.type, record.region, record.db].join('|');
    const index = (counts.get(key) ?? 0) + 1;
    counts.set(key, index);
    keys.set(record.id, { key, index });
  }
  const info = new Map();
  for (const [id, { key, index }] of keys) {
    info.set(id, { index, size: counts.get(key) });
  }
  return info;
}

// A database token matches exactly if any record has that name; otherwise by prefix.
function matchDatabases(records, token) {
  const exact = records.filter((record) => record.db.toLowerCase() === token);
  if (exact.length > 0) return { records: exact, exact: true };
  return {
    records: records.filter((record) => record.db.toLowerCase().startsWith(token)),
    exact: false,
  };
}

// An exact product name (fixed or discovered on the record) excludes longer names for that record.
function selectCandidates(candidates, productToken) {
  if (productToken === null) return candidates;
  const exact =
    PRODUCT_IDS.has(productToken) || candidates.some((candidate) => candidate.product === productToken);
  return candidates.filter((candidate) =>
    exact ? candidate.product === productToken : candidate.product.startsWith(productToken),
  );
}

// Parses a query into a Jira result, a database lookup, or nothing.
function parseQuery(query) {
  const raw = typeof query === 'string' ? query.trim() : '';
  if (raw === '') return { kind: 'none' };

  if (/^https?:/i.test(raw)) {
    const jira = parseJiraUrl(raw);
    return jira ? { kind: 'jira', result: jiraResult(jira.project, jira.number) } : { kind: 'none' };
  }

  const norm = raw.replace(/\s+/g, ' ').toLowerCase();
  const alias = parseJiraAlias(norm);
  if (alias && !alias.invalid) {
    return { kind: 'jira', result: jiraResult(alias.project, alias.number) };
  }

  const tokens = norm.split(' ');
  if (tokens.length > 2) return { kind: 'none' };
  const pairs =
    tokens.length === 1
      ? [[tokens[0], null]]
      : [
          [tokens[0], tokens[1]],
          [tokens[1], tokens[0]],
        ];
  return { kind: 'database', pairs };
}

function endpointSuggestions(pairs, records, routesByHost) {
  const rows = rowInfo(records);
  const seen = new Set();
  const found = [];

  for (const [dbToken, productToken] of pairs) {
    const matched = matchDatabases(records, dbToken);
    for (const record of matched.records) {
      const candidates = selectCandidates(productCandidates(record, routesByHost), productToken);
      for (const { product, url } of candidates) {
        const key = canonicalEndpoint(url);
        if (seen.has(key)) continue;
        seen.add(key);

        const source = SOURCES.find((entry) => entry.id === record.sourceId);
        const { index, size } = rows.get(record.id);
        const parts = [source?.label ?? record.sourceId, record.type, record.region];
        if (size > 1) parts.push(`row ${index} of ${size}`);

        found.push({
          rank: [matched.exact ? 0 : 1, productToken !== null && product === productToken ? 0 : 1],
          seq: found.length,
          result: {
            kind: 'endpoint',
            title: `${record.db} ${product}`,
            description: parts.join(' · '),
            url,
            completion: url,
            region: record.region,
            type: record.type,
            sourceId: record.sourceId,
            db: record.db,
            product,
          },
        });
      }
    }
  }

  found.sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.seq - b.seq);
  return found.map((entry) => entry.result);
}

export function suggest(query, records, limit = 30, routesByHost = {}) {
  const parsed = parseQuery(query);
  if (parsed.kind === 'jira') return [parsed.result];
  if (parsed.kind === 'database') {
    return endpointSuggestions(parsed.pairs, records, routesByHost).slice(0, limit);
  }
  return [];
}

export function isAllowedDestination(url, records = [], routesByHost = {}) {
  if (typeof url !== 'string') return false;
  const jira = parseJiraUrl(url);
  if (jira) return jira.number !== null;
  const key = canonicalEndpoint(url);
  return key !== null && endpointKeys(records, routesByHost).has(key);
}
