import { XMLParser, XMLValidator } from 'fast-xml-parser';

export const SOURCES = [
  {
    id: 'qa',
    label: 'QA / PreQA',
    url: 'https://environments.orbis.dedalus.com/xml/environments.xml',
    file: 'environments.xml',
  },
  {
    id: 'dev',
    label: 'DEV',
    url: 'https://environments.orbis.dedalus.com/xml/environments_dev_fra.xml',
    file: 'environments_dev_fra.xml',
  },
];

export const OAS_SOFTWARE = 'OAS - CON - standard:single';
export const PROXY_SOFTWARE = 'ORBIS PROXY';
const FHIR_SOFTWARE = 'OAS - APP - application:fhir';
const FHIR_BACK_END_SOFTWARE = 'OAS - APP - application:fhir-back-end';

const SUPPORTED_REGIONS = new Set(['AU', 'DACHL', 'FR', 'UKI']);
const LIST_ELEMENTS = new Set(['environment_type', 'environment', 'software']);
const DECLARATION = /<!(?:DOCTYPE|ENTITY|ELEMENT|ATTLIST|NOTATION)/i;
const HOST_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: false,
  htmlEntities: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
  isArray: (name) => LIST_ELEMENTS.has(name),
});

export function isSafeHostname(host) {
  return (
    typeof host === 'string' &&
    host.length <= 253 &&
    host.split('.').every((label) => HOST_LABEL.test(label))
  );
}

function fail(message) {
  throw new Error(`Invalid environment catalog: ${message}`);
}

function list(node, name) {
  const value = node?.[name];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function text(node, name, required = false) {
  const value = node?.[name];
  if (value === undefined) {
    if (required) fail(`missing <${name}>`);
    return '';
  }
  if (typeof value !== 'string') fail(`<${name}> must contain text exactly once`);
  if (required && value === '') fail(`empty <${name}>`);
  return value;
}

function attribute(node, name) {
  const value = node?.[`@_${name}`];
  if (typeof value !== 'string' || value === '') fail(`missing attribute "${name}"`);
  return value;
}

function namedHosts(software) {
  const hosts = [];
  for (const server of list(software, 'server')) {
    if (typeof server !== 'string') fail('<server> must contain text');
    if (server === '') continue;
    if (!isSafeHostname(server)) fail(`unsafe host "${server}"`);
    hosts.push(server);
  }
  return hosts;
}

function addUnique(target, values) {
  for (const value of values) {
    if (!target.includes(value)) target.push(value);
  }
}

export function parseEnvironments(xml, sourceId) {
  if (!SOURCES.some((source) => source.id === sourceId)) {
    throw new Error(`Unknown source "${sourceId}"`);
  }
  if (typeof xml !== 'string' || xml.trim() === '') fail('document is empty');
  if (DECLARATION.test(xml)) fail('DTD and entity declarations are not allowed');

  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    fail(`malformed XML at line ${validation.err.line}: ${validation.err.msg}`);
  }

  const doc = parser.parse(xml);
  const rootNames = Object.keys(doc);
  if (
    rootNames.length !== 1 ||
    rootNames[0] !== 'environments' ||
    typeof doc.environments !== 'object' ||
    Array.isArray(doc.environments)
  ) {
    fail('root element must be <environments>');
  }

  const root = doc.environments;
  const updatedAt = attribute(root, 'lastupdate');
  const records = [];
  let row = 0;

  for (const group of list(root, 'environment_type')) {
    const type = attribute(group, 'type');
    for (const environment of list(group, 'environment')) {
      const index = row++;
      const region = text(environment, 'region', true);
      const db = text(environment, 'db', true);
      if (!SUPPORTED_REGIONS.has(region)) continue;

      const oasHosts = [];
      const proxyHosts = [];
      const fhirHosts = [];
      const fhirBackEndHosts = [];
      for (const software of list(environment.software_installations, 'software')) {
        const name = attribute(software, 'name');
        if (name === OAS_SOFTWARE) addUnique(oasHosts, namedHosts(software));
        else if (name === PROXY_SOFTWARE) addUnique(proxyHosts, namedHosts(software));
        else if (name === FHIR_SOFTWARE) addUnique(fhirHosts, namedHosts(software));
        else if (name === FHIR_BACK_END_SOFTWARE) addUnique(fhirBackEndHosts, namedHosts(software));
      }

      records.push({
        id: `${sourceId}#${index}|${type}|${region}|${db}`,
        sourceId,
        type,
        region,
        db,
        oasHosts,
        proxyHosts,
        fhirHosts,
        fhirBackEndHosts,
      });
    }
  }

  if (records.length === 0) fail('no supported environments (AU, DACHL, FR, UKI)');
  return { updatedAt, records };
}
