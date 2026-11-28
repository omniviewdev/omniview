import { MAX_DECLARATIONS, MAX_FIELDS, parseManifestJson, unsafeKey } from './json.js';
import { utilizationV1 } from './v1.js';

// Native read/launch brokers consume the shared owner's opaque handle. No issuer is available here.
export { extensionRootProof, subscribeExtensionRoot } from '../../resource/v2/extensionRoot.js';
export type { ExtensionRootProof } from '../../resource/v2/extensionRoot.js';

type Fields = Readonly<Record<string, 'string' | 'number'>>;
type Read = { readonly id: string; readonly row: Fields };
type Section = { readonly kind: 'section' } & (
  | { readonly fields: Fields; readonly schema: { readonly label: 'string'; readonly value: 'string' } }
  | { readonly fields?: never; readonly schema?: never }
);
type Menu = { readonly kind: 'menu'; readonly fields: Fields; readonly optional?: readonly string[] };
type View = { readonly kind: 'view'; readonly fields: Fields; readonly optional?: readonly string[]; readonly read?: Read };
type Named = { readonly id: string; readonly label: string; readonly protocol: string };
type Definition = Named & (Section | Menu | View);
type Locator = { readonly package: string; readonly version: string; readonly export: string };
type Point = Named & { readonly contract: Locator } & (
  | (Section & { readonly placement: 'overview-section'; readonly warmOnPage?: string })
  | (Menu & { readonly placement: 'context-menu' })
  | (View & { readonly placement: 'detail-tab' | 'sidebar' })
);
type Action = { readonly kind: 'info' } | { readonly kind: 'openView'; readonly point: string; readonly offer: string };
type Offer = Named & { readonly requests: readonly string[] } & (
  | Section
  | (Menu & { readonly action: Action })
  | (View & { readonly requestRead?: true })
);
type Binding = {
  readonly offer: string;
  readonly target: string;
  readonly when?: readonly { readonly field: string; readonly equals: string | number }[];
};
type Manifest = {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly points: readonly Point[];
  readonly offers: readonly Offer[];
  readonly bindings: readonly Binding[];
};

// The packager and host import the same decoded data contract from this internal subpath.
export type { Manifest as ExtensionManifest, Point as ExtensionPoint, Offer as ExtensionOffer, Binding as ExtensionEdge };

type Obj = Record<string, unknown>;

function fail(at: string, expected: string): never {
  throw new Error(`Extension manifest ${at}: expected ${expected}`);
}

function record(value: unknown, at: string, members?: readonly string[]): asserts value is Obj {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(at, 'an object');
  if (members) {
    for (const key in value) if (!members.includes(key)) fail(at, `only these members: ${members.join(', ')}`);
  }
}

function list(value: unknown, at: string, min: number, max: number): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(at, `an array of ${min}–${max} entries`);
}

function omitted(value: Obj, at: string, members: readonly string[]): void {
  for (const key of members) if (value[key] !== undefined) fail(`${at}.${key}`, 'this member to be omitted');
}

function isSegment(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value) && !unsafeKey(value);
}

export { isSegment as isExtensionIdSegment };

function segment(value: unknown, at: string): asserts value is string {
  if (!isSegment(value)) fail(at, 'a safe ASCII ID segment (1–128 characters)');
}

function reservedOwner(owner: string): boolean {
  return owner === 'host' || owner === 'visuals' || owner === 'navigation';
}

/** Installed plugin IDs in extension locators may not name a host-owned namespace. */
export function isExtensionOwnerId(value: unknown): value is string {
  return isSegment(value) && !reservedOwner(value);
}

function ownerOf(name: string): string { return name.slice(0, name.indexOf('/')); }

function scopedId(value: unknown, at: string, versioned: boolean): asserts value is string {
  const expected = versioned ? 'owner/name@major with a positive 1–9 digit major' : 'a non-reserved owner/local-point ID';
  if (typeof value !== 'string' || value.length > (versioned ? 267 : 257)) fail(at, expected);
  const slash = value.indexOf('/');
  const end = versioned ? value.indexOf('@', slash + 1) : value.length;
  if (slash < 1 || end <= slash || !isSegment(value.slice(0, slash)) || !isSegment(value.slice(slash + 1, end))) fail(at, expected);
  if (versioned) {
    if (!/^[1-9][0-9]{0,8}$/.test(value.slice(end + 1))) fail(at, expected);
  } else if (reservedOwner(ownerOf(value))) fail(at, expected);
}

const STRICT_BINDING_KEYWORDS = new Set((
  'arguments await break case catch class const continue debugger default delete do else enum eval export extends false finally for ' +
  'function if implements import in instanceof interface let new null package private protected public return static super switch ' +
  'this throw true try typeof var void while with yield'
).split(' '));

function registryName(name: unknown): boolean {
  if (typeof name !== 'string' || name.length > 214 || name === 'node_modules' || name === 'favicon.ico') return false;
  if (!name.startsWith('@')) return /^[a-z0-9][a-z0-9._-]*$/.test(name);
  const match = /^@([a-z0-9._-]+)\/([a-z0-9._-]+)$/.exec(name);
  return match !== null && match[1] !== '.' && match[1] !== '..' && match[2] !== '.' && match[2] !== '..';
}

function exactVersion(version: unknown): boolean {
  if (typeof version !== 'string' || version.length > 128) return false;
  const match = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(version);
  // Numeric prerelease identifiers cannot have leading zeroes. Build metadata has no such restriction.
  return match !== null && !match[1]?.split('.').some(part => /^0[0-9]+$/.test(part));
}

function locator(value: unknown, at: string): asserts value is Locator {
  record(value, at, ['package', 'version', 'export']);
  if (!registryName(value.package)) fail(`${at}.package`, 'a lowercase npm registry package name (at most 214 characters)');
  if (!exactVersion(value.version)) fail(`${at}.version`, 'an exact SemVer 2.0.0 version (at most 128 ASCII characters)');
  const name = value.export;
  if (typeof name !== 'string' || !/^[a-zA-Z_$][a-zA-Z0-9_$]{0,127}$/.test(name) || STRICT_BINDING_KEYWORDS.has(name) || unsafeKey(name)) {
    fail(`${at}.export`, 'a safe, non-default ASCII JS binding identifier (at most 128 characters)');
  }
}

function fieldMap(value: unknown, at: string, min: number): asserts value is Fields {
  record(value, at);
  let count = 0;
  for (const key in value) {
    if (!isSegment(key) || (value[key] !== 'string' && value[key] !== 'number')) fail(at, 'safe field names with string or number type tags');
    count++;
  }
  if (count < min || count > MAX_FIELDS) fail(at, `${min}–${MAX_FIELDS} fields`);
}

function keyList(value: unknown, at: string, fields: Fields, min: number): asserts value is string[] {
  list(value, at, min, MAX_FIELDS);
  if (!value.length) return;
  const seen = new Set<string>();
  for (const key of value) {
    if (!isSegment(key) || !Object.prototype.hasOwnProperty.call(fields, key) || seen.has(key)) fail(at, 'distinct keys declared in fields');
    seen.add(key);
  }
}

function definition(v: Obj, at: string, pointOwner?: string): asserts v is Obj & Definition {
  segment(v.id, `${at}.id`);
  if (typeof v.label !== 'string' || v.label.length > 256 || v.label.trim() === '') fail(`${at}.label`, 'a nonblank label of at most 256 UTF-16 units');
  if (v.kind !== 'section' && v.kind !== 'view' && v.kind !== 'menu') fail(`${at}.kind`, 'section, menu or view');
  scopedId(v.protocol, `${at}.protocol`, true);
  if (v.protocol === utilizationV1.id) {
    if (v.kind !== utilizationV1.kind) fail(`${at}.kind`, 'section for the published utilization protocol');
    omitted(v, at, ['fields', 'schema', 'optional', 'read']);
    return;
  }

  const owner = ownerOf(v.protocol);
  if (reservedOwner(owner) || (pointOwner !== undefined && pointOwner !== owner)) fail(`${at}.protocol`, 'a supported publication or a private protocol of the point owner');
  fieldMap(v.fields, `${at}.fields`, 0);
  if (v.kind === 'section') {
    omitted(v, at, ['read', 'optional']);
    record(v.schema, `${at}.schema`, ['label', 'value']);
    if (v.schema.label !== 'string' || v.schema.value !== 'string') fail(`${at}.schema`, 'exactly {label:"string", value:"string"}');
  } else {
    omitted(v, at, ['schema']);
    if (v.optional !== undefined) keyList(v.optional, `${at}.optional`, v.fields, 1);
    if (v.read !== undefined) {
      if (v.kind !== 'view') fail(`${at}.read`, 'this member only on a private view');
      record(v.read, `${at}.read`, ['id', 'row']);
      scopedId(v.read.id, `${at}.read.id`, true);
      if (ownerOf(v.read.id) !== owner) fail(`${at}.read.id`, 'a read in the private protocol owner namespace');
      fieldMap(v.read.row, `${at}.read.row`, 1);
    }
  }
}

const DEFINITION_MEMBERS = ['id', 'label', 'kind', 'protocol', 'fields', 'schema', 'optional', 'read'];
const POINT_MEMBERS = [...DEFINITION_MEMBERS, 'placement', 'contract', 'warmOnPage'];
const OFFER_MEMBERS = [...DEFINITION_MEMBERS, 'requests', 'action', 'requestRead'];

function point(value: unknown, at: string, owner: string): asserts value is Point {
  record(value, at, POINT_MEMBERS);
  definition(value, at, owner);
  locator(value.contract, `${at}.contract`);
  if (value.kind === 'section') {
    if (value.placement !== 'overview-section') fail(`${at}.placement`, 'overview-section for a section');
    if (value.warmOnPage !== undefined) segment(value.warmOnPage, `${at}.warmOnPage`);
  } else {
    omitted(value, at, ['warmOnPage']);
    if (value.kind === 'menu') {
      if (value.placement !== 'context-menu') fail(`${at}.placement`, 'context-menu for a menu');
    } else if (value.placement === 'sidebar') {
      if (Object.keys(value.fields).length || value.read !== undefined) fail(`${at}.placement`, 'an empty, read-free view protocol for a sidebar');
    } else if (value.placement !== 'detail-tab') fail(`${at}.placement`, 'detail-tab or sidebar for a view');
  }
}

function offer(value: unknown, at: string): asserts value is Offer {
  record(value, at, OFFER_MEMBERS);
  definition(value, at);
  keyList(value.requests, `${at}.requests`, value.fields ?? utilizationV1.fields, 0);
  if (value.requestRead !== undefined && (value.kind !== 'view' || !value.read || value.requestRead !== true)) {
    fail(`${at}.requestRead`, 'only true on a view declaring a read');
  }
  if (value.kind === 'menu') {
    const action = value.action;
    record(action, `${at}.action`, ['kind', 'offer', 'point']);
    if (action.kind === 'info') omitted(action, `${at}.action`, ['offer', 'point']);
    else if (action.kind === 'openView') {
      scopedId(action.point, `${at}.action.point`, false);
      segment(action.offer, `${at}.action.offer`);
      return; // An openView offer has no executable export.
    } else fail(`${at}.action.kind`, 'info or openView');
  } else omitted(value, at, ['action']);
  if (value.id === 'default') fail(`${at}.id`, 'a non-default executable export name');
}

function sameFields(a: Fields, b: Fields): boolean {
  if (a === b) return true;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => a[key] === b[key]);
}

type Signature = {
  kind: Definition['kind']; fields: Fields; optional: ReadonlySet<string> | undefined; readId: string | undefined;
};

// Schema on a section is fixed. Read IDs and protocol IDs have separate meanings; each must have one definition per major.
function remember(v: Definition, at: string, protocols: Map<string, Signature>, reads: Map<string, Fields>): void {
  const fields = v.fields;
  if (fields === undefined) return; // Published definitions cannot be supplied by a plugin.
  const read = v.kind === 'view' ? v.read : undefined;
  if (read) {
    const row = reads.get(read.id);
    if (!row) reads.set(read.id, read.row);
    else if (!sameFields(row, read.row)) fail(`${at}.read.row`, 'one row definition per versioned read ID');
  }
  const optional = v.kind === 'section' ? undefined : v.optional;
  const previous = protocols.get(v.protocol);
  if (!previous) {
    protocols.set(v.protocol, { kind: v.kind, fields, optional: optional && new Set(optional), readId: read?.id });
  } else if (previous.kind !== v.kind || previous.readId !== read?.id || !sameFields(previous.fields, fields) ||
      previous.optional?.size !== optional?.length || optional?.some(key => !previous.optional?.has(key))) {
    fail(`${at}.protocol`, 'one complete definition per versioned protocol ID');
  }
}

function comparisons(value: unknown, at: string, from: Offer, to: Point | undefined): void {
  if (from.kind === 'section' || to?.placement === 'sidebar') fail(at, 'conditions only on menu or detail-tab bindings');
  list(value, at, 1, 4);
  const seen = new Set<string>();
  for (const [i, comparison] of value.entries()) {
    const path = `${at}[${i}]`;
    record(comparison, path, ['field', 'equals']);
    const key = comparison.field;
    if (!isSegment(key) || !from.requests.includes(key) || seen.has(key)) fail(`${path}.field`, 'a distinct requested field');
    const equals = comparison.equals;
    if (from.fields[key] === 'string' ? typeof equals !== 'string' || equals.length > 256 : typeof equals !== 'number') {
      fail(`${path}.equals`, 'the declared scalar type, with strings at most 256 UTF-16 units');
    }
    seen.add(key);
  }
}

type From = { offer: Offer; at: string; targets: Set<string> };

function binding(value: unknown, at: string, source: string, points: Map<string, Point>, offers: Map<string, From>): void {
  record(value, at, ['offer', 'target', 'when']);
  segment(value.offer, `${at}.offer`);
  scopedId(value.target, `${at}.target`, false);
  const from = offers.get(value.offer);
  if (!from) fail(`${at}.offer`, 'a declared local offer');
  const target = value.target;
  if (from.targets.has(target)) fail(at, 'a unique (target, offer) pair');
  const owner = ownerOf(target);
  const to = points.get(target);
  if (owner === source && !to) fail(`${at}.target`, 'a declared point for a same-source binding');
  const offer = from.offer;
  if (offer.protocol !== utilizationV1.id && owner !== ownerOf(offer.protocol)) fail(`${at}.target`, 'the owner of the private protocol');
  // remember() already proved equal definitions when protocol IDs match inside this source.
  if (to && to.protocol !== offer.protocol) fail(`${at}.target`, 'the exact point protocol for this offer');
  if (value.when !== undefined) comparisons(value.when, `${at}.when`, offer, to);
  if (offer.kind === 'menu' && offer.action.kind === 'openView' && ownerOf(offer.action.point) !== owner) {
    fail(`${at}.target`, 'the same owner as the openView destination');
  }
  from.targets.add(target);
}

function manifest(value: unknown, installedId: string): asserts value is Manifest {
  record(value, 'root', ['schemaVersion', 'id', 'points', 'offers', 'bindings']);
  if (value.schemaVersion !== 1) fail('schemaVersion', '1');
  if (!isExtensionOwnerId(installedId) || value.id !== installedId) fail('id', 'the verified, non-reserved installed source ID');
  list(value.points, 'points', 0, MAX_DECLARATIONS);
  list(value.offers, 'offers', 0, MAX_DECLARATIONS);
  list(value.bindings, 'bindings', 0, MAX_DECLARATIONS);

  const protocols = new Map<string, Signature>();
  const reads = new Map<string, Fields>();
  const points = new Map<string, Point>();
  const locators = new Set<string>();
  for (const [i, p] of value.points.entries()) {
    const at = `points[${i}]`;
    point(p, at, installedId);
    const target = `${installedId}/${p.id}`;
    if (points.has(target)) fail(`${at}.id`, 'a unique local point ID');
    points.set(target, p);
    const locator = `${p.contract.package}@${p.contract.version}#${p.contract.export}`;
    if (locators.has(locator)) fail(`${at}.contract`, 'one point per named package export');
    locators.add(locator);
    remember(p, at, protocols, reads);
  }
  const offers = new Map<string, From>();
  for (const [i, o] of value.offers.entries()) {
    const at = `offers[${i}]`;
    offer(o, at);
    if (offers.has(o.id)) fail(`${at}.id`, 'a unique local offer ID');
    offers.set(o.id, { offer: o, at, targets: new Set() });
    remember(o, at, protocols, reads);
  }
  for (const [i, b] of value.bindings.entries()) binding(b, `bindings[${i}]`, installedId, points, offers);
  for (const { offer, at, targets } of offers.values()) {
    if (!targets.size) fail(at, 'at least one binding for each offer');
    if (offer.kind === 'menu' && offer.action.kind === 'openView') {
      const destination = offers.get(offer.action.offer);
      if (destination?.offer.kind !== 'view') fail(`${at}.action.offer`, 'a local view offer');
      if (!destination.targets.has(offer.action.point)) fail(`${at}.action.point`, 'an explicit binding of the destination view offer to this exact point');
    }
  }
}

/** Byte readers must cap the artifact at 256 KiB before decoding with fatal UTF-8. This entry never evaluates plugin code. */
export function decodeExtensionManifest(installedId: string, json: string): Manifest {
  const result = parseManifestJson(json);
  manifest(result, installedId);
  return result;
}
