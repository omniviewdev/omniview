import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { decodeExtensionManifest } from './wire.js';

const locator = { package: '@owner/points', version: '2.0.0-rc.1+build.003', export: 'inspectTab' };
const published = { kind: 'section', protocol: 'visuals/utilization@1' };
const factPoint = { ...published, id: 'fact', label: 'Fact', placement: 'overview-section', contract: { ...locator, export: 'fact' } };
const factOffer = { ...published, id: 'fact', label: 'Fact', requests: ['used'] };
const view = {
  kind: 'view', protocol: 'owner/inspect@2', fields: { kind: 'string', count: 'number', tag: 'string' }, optional: ['tag', 'count'],
  read: { id: 'owner/neighbors@1', row: { name: 'string', rank: 'number' } },
};
const tab = { ...view, id: 'inspect', label: 'Inspector', placement: 'detail-tab', contract: locator };
const inspect = { ...view, id: 'inspect', label: 'Inspector', requests: ['count', 'kind'], requestRead: true };
const tabEdge = { offer: 'inspect', target: 'owner/inspect' };
const menu = { kind: 'menu', protocol: 'owner/commands@3', fields: { tag: 'string', count: 'number' }, optional: ['tag'] };
const menuPoint = { ...menu, id: 'tools', label: 'Tools', placement: 'context-menu', contract: { ...locator, export: 'tools' } };
const open = { ...menu, id: 'open', label: 'Inspect', requests: ['tag', 'count'], action: { kind: 'openView', point: 'owner/inspect', offer: 'inspect' } };
const openEdge = { offer: 'open', target: 'owner/tools' };

function document(changes: Record<string, unknown> = {}) {
  return { schemaVersion: 1, id: 'owner', points: [], offers: [], bindings: [], ...changes };
}
function decode(changes: Record<string, unknown>, installedId = 'owner') {
  return decodeExtensionManifest(installedId, JSON.stringify(document(changes)));
}

const linked = { points: [tab, menuPoint], offers: [open, inspect], bindings: [openEdge, tabEdge] };

describe('extension manifest decoder', () => {
  it('returns plain wire data, without materializing published shapes, defaults or discovery state', () => {
    const section = { kind: 'section', protocol: 'owner/other@8', fields: { count: 'number' }, schema: { label: 'string', value: 'string' } };
    const emptyView = { kind: 'view', protocol: 'owner/empty@1', fields: {} };
    const data = {
      points: [
        tab, menuPoint, { ...factPoint, warmOnPage: 'Overview.1' },
        { ...factPoint, ...section, id: 'another', contract: { ...locator, export: 'another' } },
        { ...tab, ...emptyView, id: 'empty', read: undefined, optional: undefined, placement: 'sidebar', contract: { ...locator, export: 'empty' } },
      ],
      offers: [
        { ...open, id: 'default' }, // No executable lookup for openView.
        { ...inspect, fields: { tag: 'string', count: 'number', kind: 'string' }, optional: ['count', 'tag'],
          read: { id: view.read.id, row: { rank: 'number', name: 'string' } } },
        { ...factOffer, id: 'fact-1' },
        { ...section, id: 'another', label: 'Inspector', requests: [] },
        { ...open, id: 'info', action: { kind: 'info' } },
        { ...emptyView, id: 'empty', label: 'Inspector', requests: [] },
      ],
      bindings: [
        { ...openEdge, offer: 'default', when: [{ field: 'tag', equals: '' }, { field: 'count', equals: 0 }] },
        { ...tabEdge, when: [{ field: 'count', equals: -12.5 }] },
        { offer: 'fact-1', target: 'owner/fact' }, { offer: 'fact-1', target: 'other/fact' },
        { offer: 'another', target: 'owner/another' }, { ...openEdge, offer: 'info' }, { offer: 'empty', target: 'owner/empty' },
      ],
    };
    const text = JSON.stringify(document(data));
    const decoded = decodeExtensionManifest('owner', text);
    expect(JSON.stringify(decoded)).toBe(text);
    expect(decoded.points[2]).not.toHaveProperty('fields');
  });

  it('admits external edges without installing their target or evaluating any code', () => {
    expect(decode({ ...linked, id: 'peer', points: [] }, 'peer').bindings).toEqual([openEdge, tabEdge]);
    expect(decode({})).toEqual(document());
  });

  it('accepts declared own keys, not properties inherited by published maps', () => {
    const own = { ...view, fields: { toString: 'string', hasOwnProperty: 'number' }, optional: ['hasOwnProperty'] };
    expect(decode({ points: [{ ...tab, ...own }], offers: [{ ...inspect, ...own, requests: ['toString'] }], bindings: [tabEdge] }).offers).toHaveLength(1);
    expect(() => decode({ offers: [{ ...factOffer, requests: ['toString'] }], bindings: [{ offer: 'fact', target: 'other/fact' }] })).toThrow(/requests/);
  });

  it.each([
    ['wrong schema version', { schemaVersion: 2 }], ['missing points', { points: undefined }],
    ['wrong source', { id: 'different' }], ['injected grant', { grants: [] }], ['null offers', { offers: null }],
    ['map-shaped bindings', { bindings: { 0: tabEdge } }], ['null declaration', { points: [null] }],
  ])('rejects %s', (_name, changes) => {
    expect(() => decode(changes as Record<string, unknown>)).toThrow(/Extension manifest/);
  });
});

describe('bounded duplicate-aware JSON', () => {
  it.each([
    ['duplicate root member', '{"id":"owner","\\u0069d":"owner"}', /unique object members/],
    ['duplicate nested member', '{"points":[{"fields":{"count":"number","co\\u0075nt":"string"}}]}', /unique object members/],
    ['escaped unsafe member', '{"points":[{"fields":{"\\u005f_proto__":"number"}}]}', /safe member name/],
    ['unsafe constructor', '{"x":{"constructor":1}}', /safe member name/],
    ['unsafe prototype', '{"x":{"prototype":1}}', /safe member name/],
    ['array hole', '{"points":[,]}', /JSON/], ['trailing array comma', '{"a":[0,]}', /JSON/],
    ['trailing object comma', '{"a":1,}', /JSON/], ['missing colon', '{"a" 0}', /JSON/],
    ['unterminated member', '{"a', /JSON/], ['foreign escape', '{"a":"\\x41"}', /JSON/],
    ['unescaped control', '{"a":"\n"}', /JSON/], ['leading zero', '{"x":01}', /JSON/],
    ['trailing decimal point', '{"x":1.}', /JSON/], ['missing exponent', '{"x":1e+}', /JSON/],
    ['nonfinite number', '{"x":1e500}', /finite number/], ['JavaScript expression', '{"x":NaN}', /JSON/],
    ['invalid whitespace', '\u00a0{}', /JSON/], ['concatenated documents', '{} {}', /end of input/],
    ['comment', '/* not JSON */ {}', /JSON/], ['raw lone surrogate', '{"a":"\uD800"}', /Unicode/],
    ['escaped lone surrogate', '{"a":"\\uDC00"}', /Unicode/], ['trailing high surrogate', '\uD800', /Unicode/],
    ['excessive nesting', '['.repeat(10_000) + ']'.repeat(10_000), /nested containers/],
  ] as const)('rejects %s before semantic admission', (_name, json, expected) => {
    expect(() => decodeExtensionManifest('owner', json)).toThrow(expected);
  });

  it('checks the inclusive byte boundary before parsing, not just the JS string length', () => {
    const json = JSON.stringify(document({ points: [{ ...tab, label: 'Aé漢😀' }] }));
    const atLimit = ' '.repeat(256 * 1024 - Buffer.byteLength(json, 'utf8')) + json;
    expect(decodeExtensionManifest('owner', atLimit).points).toHaveLength(1);
    expect(() => decodeExtensionManifest('owner', atLimit + '\n')).toThrow(/256 KiB/);
  });

  it('decodes escaped surrogate pairs, quotes and newlines without changing strings', () => {
    const json = JSON.stringify(document({ points: [{ ...tab, label: 'PLACEHOLDER' }] }))
      .replace('PLACEHOLDER', 'a\\uD83D\\uDE0A\\"\\n');
    expect(decodeExtensionManifest('owner', '\n\t' + json + '\r').points[0]?.label).toBe('a😊"\n');
  });

  it('never echoes unknown members, label text or string parser input in diagnostics', () => {
    const privateText = 'private-value-that-must-not-be-logged';
    for (const text of [JSON.stringify(document({ [privateText]: true })), `{"a":"${privateText}\\z"}`,
      JSON.stringify(document({ points: [{ ...tab, label: { text: privateText } }] }))]) {
      expect(() => decodeExtensionManifest('owner', text)).toThrow(/expected/);
      expect(() => decodeExtensionManifest('owner', text)).not.toThrow(privateText);
    }
  });
});

describe('closed wire vocabulary', () => {
  it.each([
    ['point ID', { ...tab, id: 'owner/other' }], ['unsafe ID', { ...tab, id: 'constructor' }], ['foreign kind', { ...tab, kind: 'page' }],
    ['non-ASCII ID', { ...tab, id: 'détail' }], ['long ID', { ...tab, id: 'a'.repeat(129) }], ['invalid page key', { ...factPoint, warmOnPage: '../home' }],
    ['blank label', { ...tab, label: ' \t\n' }], ['long label', { ...tab, label: '😀'.repeat(128) + 'a' }],
    ['foreign member', { ...tab, load: 'file.js' }], ['incompatible placement', { ...menuPoint, placement: 'detail-tab' }],
    ['implicit placement', { ...tab, placement: undefined }], ['view hint', { ...tab, warmOnPage: 'home' }],
    ['sidebar fields', { ...tab, placement: 'sidebar', read: undefined }], ['sidebar read', { ...tab, placement: 'sidebar', fields: {}, optional: undefined }],
    ['incomplete private definition', { ...tab, fields: undefined }], ['unsupported type tag', { ...tab, fields: { value: 'boolean' } }],
    ['field path', { ...menuPoint, fields: { 'invalid key': 'string' } }], ['optional null', { ...tab, optional: null }],
    ['empty optional tuple', { ...tab, optional: [] }], ['undeclared optional', { ...tab, optional: ['absent'] }],
    ['duplicate optional', { ...tab, optional: ['tag', 'tag'] }], ['menu schema', { ...menuPoint, schema: {} }], ['menu read', { ...menuPoint, read: view.read }],
    ['unknown read member', { ...tab, read: { ...view.read, dispatch: 'x' } }], ['empty read row', { ...tab, read: { ...view.read, row: {} } }],
    ['read row type', { ...tab, read: { ...view.read, row: { rank: { type: 'number' } } } }], ['foreign read', { ...tab, read: { ...view.read, id: 'other/read@1' } }],
    ['foreign point protocol', { ...tab, protocol: 'other/view@1' }], ['reserved protocol', { ...tab, protocol: 'navigation/view@1' }],
    ['unknown publication', { ...factPoint, protocol: 'visuals/utilization@2' }], ['published kind', { ...tab, protocol: published.protocol }],
    ['inline publication', { ...factPoint, fields: { used: 'number', capacity: 'number' } }], ['published optional', { ...factPoint, optional: [] }],
    ['published schema', { ...factPoint, schema: { label: 'string', value: 'string' } }],
    ['private section schema', { ...factPoint, protocol: 'owner/fact@1', fields: {} }],
    ['extra result tag', { ...factPoint, protocol: 'owner/fact@1', fields: {}, schema: { label: 'string', value: 'string', unit: 'string' } }],
    ['wrong result tag', { ...factPoint, protocol: 'owner/fact@1', fields: {}, schema: { label: 'string', value: 'number' } }],
  ] as const)('rejects %s', (_name, bad) => {
    expect(() => decode({ points: [bad] })).toThrow();
  });

  it.each(['host', 'visuals', 'navigation', 'bad/source', ''])('rejects reserved or malformed installed source %j', id => {
    expect(() => decode({ id }, id)).toThrow(/installed source/);
  });

  it.each(['owner', 'owner/tabs', 'owner/tabs@0', 'owner/tabs@01', 'owner/tabs@-1', 'owner/tabs@1000000000', 'owner/tabs@1.0', 'owner/tabs@1/2'])('rejects protocol ID %j', protocol => {
    expect(() => decode({ points: [{ ...tab, protocol }] })).toThrow(/protocol/);
  });

  it('accepts inclusive identifier and UTF-16 bounds', () => {
    const id = 'A'.repeat(128);
    const protocol = `${id}/${id}@999999999`;
    const p = { ...tab, id, protocol, label: '😀'.repeat(128), read: { ...view.read, id: protocol } };
    expect(decode({ id, points: [p] }, id).points[0]?.id).toBe(id);
  });

  it.each([
    ['package', 'UPPER'], ['package', 'file:somewhere'], ['package', 'pkg@2'], ['package', 'pkg/subpath'],
    ['package', '@org/pkg/deep'], ['package', '@scope/..'], ['package', '@../pkg'], ['package', '_private'], ['package', 'node_modules'],
    ['package', 'a'.repeat(215)], ['version', '1.2'], ['version', '^1.0.0'], ['version', 'latest'], ['version', 'v1.2.3'],
    ['version', '01.2.3'], ['version', '1.2.3-01'], ['version', '1.2.3+a..b'], ['version', '1.2.3+' + 'x'.repeat(123)],
    ['export', 'default'], ['export', 'await'], ['export', 'class'], ['export', 'has-dash'], ['export', 'élan'],
    ['export', 'a'.repeat(129)], ['export', '__proto__'], ['subpath', '.'],
  ])('refuses invalid contract.%s locator %j', (key, value) => {
    expect(() => decode({ points: [{ ...tab, contract: { ...locator, [key]: value } }] })).toThrow(/contract/);
  });

  it('accepts exact SemVer with numeric build leading zeroes and alphanumeric prerelease identifiers', () => {
    for (const version of ['0.0.0', '1.2.3-0.012beta.a---z+001.02', '1.2.3+' + 'x'.repeat(122)]) {
      const contract = { package: 'a'.repeat(214), version, export: '$' + '_'.repeat(127) };
      expect(decode({ points: [{ ...tab, contract }] }).points[0]?.contract).toEqual(contract);
    }
  });

  it.each([
    ['unknown request', { ...inspect, requests: ['absent'] }], ['repeated request', { ...inspect, requests: ['kind', 'kind'] }],
    ['wrong requestRead', { ...inspect, requestRead: false }], ['read request without read', { ...inspect, read: undefined }],
    ['view action', { ...inspect, action: { kind: 'info' } }], ['export path', { ...inspect, id: 'assets/views.js' }],
    ['default view export', { ...inspect, id: 'default' }], ['default section export', { ...factOffer, id: 'default' }],
    ['default feature export', { ...open, id: 'default', action: { kind: 'info' } }],
    ['missing action', { ...open, action: undefined }], ['null action', { ...open, action: null }],
    ['new action', { ...open, action: { kind: 'execute' } }], ['mixed info action', { ...open, action: { ...open.action, kind: 'info' } }],
    ['surplus action field', { ...open, action: { ...open.action, params: {} } }], ['qualified destination offer', { ...open, action: { ...open.action, offer: 'owner/inspect' } }],
    ['unqualified destination point', { ...open, action: { ...open.action, point: 'inspect' } }],
    ['inline published fields', { ...factOffer, fields: {} }], ['published read request', { ...factOffer, requestRead: true }],
  ] as const)('refuses %s before checking edges', (_name, bad) => {
    expect(() => decode({ offers: [bad] })).toThrow(/offers\[0\]\./);
  });
});

describe('protocol and edge consistency within a source', () => {
  it.each([
    ['changed kind', { ...inspect, kind: 'menu', requestRead: undefined, read: undefined, action: { kind: 'info' } }],
    ['changed field set', { ...inspect, fields: { ...view.fields, extra: 'string' } }],
    ['changed field type', { ...inspect, fields: { ...view.fields, count: 'string' } }],
    ['changed optionality', { ...inspect, optional: ['count'] }],
    ['changed read ID', { ...inspect, read: { ...view.read, id: 'owner/other@1' } }],
    ['missing read', { ...inspect, read: undefined, requestRead: undefined }],
    ['changed read row', { ...inspect, read: { ...view.read, row: { ...view.read.row, rank: 'string' } } }],
  ] as const)('refuses %s for the same protocol major', (_name, bad) => {
    expect(() => decode({ points: [tab], offers: [bad], bindings: [tabEdge] })).toThrow(/one .*definition/);
  });

  it('compares read schemas across separate protocol IDs, even for parked external edges', () => {
    const second = { ...inspect, protocol: 'owner/second@1', id: 'second', read: { ...view.read, row: { name: 'string' } } };
    expect(() => decode({ id: 'peer', offers: [inspect, second], bindings: [tabEdge, { offer: 'second', target: 'owner/other' }] }, 'peer')).toThrow(/read.row/);
  });

  it.each([
    ['duplicate point', { points: [tab, tab] }], ['duplicate root export', { points: [tab, { ...tab, id: 'second' }] }],
    ['duplicate offer', { offers: [inspect, inspect] }], ['unbound offer', { offers: [inspect] }],
    ['undeclared offer', { bindings: [tabEdge] }], ['same-source typo', { offers: [inspect], bindings: [tabEdge] }],
    ['wrong private owner', { ...linked, bindings: [openEdge, { ...tabEdge, target: 'other/inspect' }] }],
    ['different protocol major', { points: [tab], offers: [{ ...inspect, protocol: 'owner/inspect@1' }], bindings: [tabEdge] }],
    ['different protocol ID', { points: [tab], offers: [{ ...inspect, protocol: 'owner/other@2' }], bindings: [tabEdge] }],
    ['malformed target', { ...linked, bindings: [{ ...openEdge, target: 'owner/../tools' }, tabEdge] }],
    ['reserved target', { offers: [factOffer], bindings: [{ offer: 'fact', target: 'host/fact' }] }],
    ['surplus binding member', { ...linked, bindings: [{ ...openEdge, navigate: true }, tabEdge] }],
    ['duplicate conditional edge', { ...linked, bindings: [openEdge, { ...openEdge, when: [{ field: 'tag', equals: '' }] }, tabEdge] }],
    ['section predicate', { points: [factPoint], offers: [factOffer], bindings: [{ offer: 'fact', target: 'owner/fact', when: [{ field: 'used', equals: 0 }] }] }],
    ['sidebar predicate', { points: [{ ...tab, fields: {}, optional: undefined, read: undefined, placement: 'sidebar' }],
      offers: [{ ...inspect, fields: {}, optional: undefined, read: undefined, requests: [], requestRead: undefined }], bindings: [{ ...tabEdge, when: [{ field: 'tag', equals: '' }] }] }],
  ] as const)('refuses %s', (_name, changes) => {
    expect(() => decode(changes)).toThrow();
  });

  it.each([
    ['empty conjunction', []], ['wrong scalar type', [{ field: 'count', equals: '1' }]],
    ['unsupported scalar', [{ field: 'count', equals: null }]], ['unrequested comparison', [{ field: 'tag', equals: '' }]],
    ['repeated field', [{ field: 'count', equals: 1 }, { field: 'count', equals: 2 }]], ['missing equals', [{ field: 'kind' }]],
    ['surplus operator', [{ field: 'kind', equals: 'x', regex: true }]], ['long string', [{ field: 'kind', equals: '😀'.repeat(128) + 'x' }]],
    ['five comparisons', Array.from({ length: 5 }, () => ({ field: 'count', equals: 1 }))],
  ])('refuses %s without dropping or broadening the predicate', (_name, when) => {
    expect(() => decode({ ...linked, bindings: [openEdge, { ...tabEdge, when }] })).toThrow(/when/);
  });

  it('resolves openView to a local view offer at the exact point under the invoking owner', () => {
    const bad = (action: unknown) => () => decode({ ...linked, offers: [{ ...open, action }, inspect] });
    expect(bad({ ...open.action, offer: 'open' })).toThrow(/local view offer/);
    expect(bad({ ...open.action, offer: 'absent' })).toThrow(/local view offer/);
    expect(bad({ ...open.action, point: 'owner/not-bound' })).toThrow(/explicit binding/);
    const other = { ...inspect, protocol: 'other/inspect@2', read: { ...view.read, id: 'other/read@1' } };
    expect(() => decode({ points: [menuPoint], offers: [other, { ...open, action: { ...open.action, point: 'other/inspect' } }],
      bindings: [{ ...tabEdge, target: 'other/inspect' }, openEdge] })).toThrow(/same owner/);
  });
});

describe('declaration budgets', () => {
  it('enforces N and N+1 for each declaration list, independent of bytes and duplicate IDs', () => {
    const points = Array.from({ length: 1024 }, (_, i) => ({ ...factPoint, id: `p${i}`, contract: { ...locator, package: 'p', version: '0.0.0', export: `p${i}` } }));
    const offers = Array.from({ length: 1024 }, (_, i) => ({ ...factOffer, id: `o${i}` }));
    const bindings = offers.map(({ id }) => ({ offer: id, target: 'external/fact' }));
    expect(decode({ points }).points).toHaveLength(1024);
    expect(decode({ offers, bindings }).bindings).toHaveLength(1024);
    expect(() => decode({ points: [...points, points[0]] })).toThrow(/1024/);
    expect(() => decode({ offers: [...offers, offers[0]], bindings })).toThrow(/1024/);
    expect(() => decode({ offers, bindings: [...bindings, bindings[0]] })).toThrow(/1024/);
  });

  it('bounds maps and tuples independently and admits four distinct granted-type comparisons', () => {
    const keys = Array.from({ length: 64 }, (_, i) => `f${i}`);
    const fields = Object.fromEntries(keys.map(k => [k, 'string']));
    const shape = { fields, optional: keys, read: { id: view.read.id, row: fields } };
    const p = { ...tab, ...shape };
    const o = { ...inspect, ...shape, requests: keys };
    const when = keys.slice(0, 4).map(field => ({ field, equals: '😀'.repeat(128) }));
    expect(decode({ points: [p], offers: [o], bindings: [{ ...tabEdge, when }] }).bindings[0]?.when).toHaveLength(4);
    const extra = { ...fields, extra: 'number' };
    expect(() => decode({ points: [{ ...p, fields: extra }] })).toThrow(/64/);
    expect(() => decode({ points: [{ ...p, read: { ...shape.read, row: extra } }] })).toThrow(/64/);
    expect(() => decode({ points: [{ ...p, optional: [...keys, 'extra'] }] })).toThrow(/64/);
    expect(() => decode({ offers: [{ ...o, requests: [...keys, 'extra'] }] })).toThrow(/64/);
  });
});
