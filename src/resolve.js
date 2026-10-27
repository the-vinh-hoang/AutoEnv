import { SOURCES } from './catalog.js';

export const JIRA_ORIGIN = 'https://dedalus.atlassian.net';
const JIRA_BROWSE = '/browse/';
const JIRA_ALIASES = new Map([
  ['bug', 'ORBISBUG'],
  ['orbisbug', 'ORBISBUG'],
  ['defect', 'ORBISBUG'],
  ['hconn', 'HCONN'],
  ['story', 'HCONN'],
  ['hepic', 'HEPIC'],
  ['epic', 'HEPIC'],
]);
const JIRA_TICKET_PATH = /^(ORBISBUG|HCONN|HEPIC)-([1-9]\d*)?$/;
const JIRA_NUMBER = /^[1-9]\d*$/;
const ENDPOINT_URL = /^https:\/\/([A-Za-z0-9.-]+)(?::(\d{1,5}))?(\/[^?#\s]*)?$/i;

const OAS = 'oasHosts';
const PROXY = 'proxyHosts';

// Product rules: each record's hosts of the named kind produce one URL per product.
const PRODUCTS = [
  { id: 'webstart', hosts: OAS, port: 8443, path: '/webstart' },
  { id: 'bpe', hosts: OAS, port: 8443, path: '/webstart' },
  { id: 'ucc', hosts: OAS, port: 8443, path: '/ucc' },
  { id: 'oas', hosts: OAS, port: 9993, path: '/console/index.html' },
  { id: 'console', hosts: OAS, port: 9993, path: '/console/index.html' },
  { id: 'u', hosts: PROXY, path: '/u' },
  { id: 'iris', hosts: PROXY, path: '/u/iris' },
  { id: 'iris-tracing', hosts: PROXY, path: '/u/iris-tracing' },
  { id: 'iris-fhir', hosts: PROXY, path: '/u/iris-fhir' },
];

function endpointUrl(host, product) {
  const port = product.port === undefined ? '' : `:${product.port}`;
  return `https://${host}${port}${product.path}`;
}

// Scheme and host are case-insensitive; the path stays case-sensitive.
function canonicalEndpoint(url) {
  const match = ENDPOINT_URL.exec(url);
  if (!match || match[3] === undefined) return null;
  const port = match[2] === undefined ? '' : `:${match[2]}`;
  return `https://${match[1].toLowerCase()}${port}${match[3]}`;
}

function endpointKeys(records) {
  const keys = new Set();
  for (const record of records) {
    for (const product of PRODUCTS) {
      for (const host of record[product.hosts]) {
        keys.add(canonicalEndpoint(endpointUrl(host, product)));
      }
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

function endpointSuggestions(norm, records) {
  const tokens = norm.split(' ');
  if (tokens.length > 2) return [];

  const pairs =
    tokens.length === 1
      ? [[tokens[0], null]]
      : [
          [tokens[0], tokens[1]],
          [tokens[1], tokens[0]],
        ];
  const rows = rowInfo(records);
  const seen = new Set();
  const found = [];

  for (const [dbToken, productToken] of pairs) {
    const matched = matchDatabases(records, dbToken);
    if (matched.records.length === 0) continue;
    const exactProduct = PRODUCTS.find(product => product.id === productToken);
    const products = exactProduct ? [exactProduct] : PRODUCTS.filter(
      product => productToken === null || product.id.startsWith(productToken),
    );

    for (const record of matched.records) {
      for (const product of products) {
        for (const host of record[product.hosts]) {
          const url = endpointUrl(host, product);
          const key = canonicalEndpoint(url);
          if (seen.has(key)) continue;
          seen.add(key);

          const source = SOURCES.find((entry) => entry.id === record.sourceId);
          const { index, size } = rows.get(record.id);
          const parts = [source?.label ?? record.sourceId, record.type, record.region];
          if (size > 1) parts.push(`row ${index} of ${size}`);

          found.push({
            rank: [
              matched.exact ? 0 : 1,
              productToken !== null && product.id === productToken ? 0 : 1,
            ],
            seq: found.length,
            result: {
              kind: 'endpoint',
              title: `${record.db} ${product.id}`,
              description: parts.join(' · '),
              url,
              completion: url,
              region: record.region,
              type: record.type,
              sourceId: record.sourceId,
              db: record.db,
              product: product.id,
            },
          });
        }
      }
    }
  }

  found.sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.seq - b.seq);
  return found.map((entry) => entry.result);
}

export function suggest(query, records, limit = 30) {
  const raw = typeof query === 'string' ? query.trim() : '';
  if (raw === '') return [];

  if (/^https?:/i.test(raw)) {
    const jira = parseJiraUrl(raw);
    return jira ? [jiraResult(jira.project, jira.number)] : [];
  }

  const norm = raw.replace(/\s+/g, ' ').toLowerCase();
  const alias = parseJiraAlias(norm);
  if (alias) return alias.invalid ? [] : [jiraResult(alias.project, alias.number)];

  return endpointSuggestions(norm, records).slice(0, limit);
}

export function isAllowedDestination(url, records = []) {
  if (typeof url !== 'string') return false;
  const jira = parseJiraUrl(url);
  if (jira) return jira.number !== null;
  const key = canonicalEndpoint(url);
  return key !== null && endpointKeys(records).has(key);
}
