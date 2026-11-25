import { describe, expect, it } from 'vitest';
import { admitRow, admitRows, PALETTE_LIMITS, type RowRules } from './paletteRows';

// What a plugin's provider answers is `unknown` until this says otherwise: each row is read one at a time, and one that is not valid is left out with a problem that names it. A row is data: words, a glyph the
// kit has, and a route in the plugin's own pages or the id of one of its commands. Invented plugin (Acme, widgets); the host knows no plugin.

type Loose = Record<string, unknown>;

/** What Acme has: a list page, a detail page whose object is named by `name`, an overview page (the page of a scope: no parameters, as a list page has none) and one command. */
const rules: RowRules = {
  pages: {
    widgets: { kind: 'list', definition: { title: 'Widgets' } },
    widget: { kind: 'detail', definition: { identity: { name: 'name' } } },
    overview: { kind: 'overview', definition: { title: 'Overview' } },
    landing: { kind: 'custom', scope: 'plugin', title: 'Landing' },
  },
  commands: { reset: {} },
};

const row = (patch: Loose = {}): Loose => ({ id: 'w:one', label: 'one', icon: 'box', route: { page: 'widgets', params: {} }, ...patch });

const problemOf = (raw: unknown, over: RowRules = rules): string | undefined => {
  const admission = admitRow(raw, over, 0);
  return admission.ok ? undefined : admission.problem;
};

describe('admitRow', () => {
  it('admits a row that names a page, and hands back a copy that is the data the host reads: the words trimmed and on one line, the route in its own shape', () => {
    const raw = row({ label: '  one \n two ', secondary: ' in  Acme ', keywords: ' w1 ', route: { page: 'widgets', connection: 'north', params: {} } });
    const admission = admitRow(raw, rules, 0);

    expect(admission).toEqual({
      ok: true,
      row: { id: 'w:one', label: 'one two', secondary: 'in Acme', keywords: 'w1', icon: 'box', route: { page: 'widgets', connection: 'north', params: {} }, command: undefined },
    });
    expect(admission.ok && admission.row).not.toBe(raw);
  });

  it('admits a row that names an overview page: with no parameters, as a list page is named, and in a connection', () => {
    expect(admitRow(row({ route: { page: 'overview', params: {} } }), rules, 0)).toMatchObject({ ok: true, row: { route: { page: 'overview', params: {} } } });
    expect(admitRow(row({ route: { page: 'overview', connection: 'north', params: {} } }), rules, 0)).toMatchObject({ ok: true, row: { route: { page: 'overview', connection: 'north', params: {} } } });
  });

  it('admits a row that names a command, with and without an argument, and one that names a detail page with the parameter that names its object', () => {
    expect(admitRow({ id: 'c', label: 'Reset', icon: 'refresh', command: { id: 'reset' } }, rules, 0)).toMatchObject({ ok: true, row: { command: { id: 'reset', arg: undefined }, route: undefined } });
    expect(admitRow({ id: 'c', label: 'Reset', icon: 'box', command: { id: 'reset', arg: { all: true, names: ['a', 1, null] } } }, rules, 0)).toMatchObject({
      ok: true,
      row: { command: { id: 'reset', arg: { all: true, names: ['a', 1, null] } } },
    });
    expect(admitRow(row({ route: { page: 'widget', params: { name: 'a' } } }), rules, 0)).toMatchObject({ ok: true, row: { route: { page: 'widget', params: { name: 'a' } } } });
  });

  it('copies what it reads: a plugin that changes the row, its route or its argument afterwards changes nothing the host holds', () => {
    const route = { page: 'widget', params: { name: 'a' } };
    const arg = { list: [1] };
    const raw = row({ route, command: undefined });
    const command = { id: 'c', label: 'Reset', icon: 'box', command: { id: 'reset', arg } };
    const first = admitRow(raw, rules, 0);
    const second = admitRow(command, rules, 0);
    route.params.name = 'b';
    arg.list.push(2);
    raw.label = 'changed';

    expect(first.ok && first.row.route?.params).toEqual({ name: 'a' });
    expect(first.ok && first.row.label).toBe('one');
    expect(second.ok && second.row.command?.arg).toEqual({ list: [1] });
  });

  it.each([
    ['a row that is not an object', 3, 'row 0 is not an object'],
    ['a row that is null', null, 'row 0 is not an object'],
    ['a row that is a list', [], 'row 0 is not an object'],
    ['a row with no id', row({ id: undefined }), 'row 0: id is not a non-empty string of at most 256 characters'],
    ['a row whose id is blank', row({ id: '  ' }), 'row 0: id is not a non-empty string of at most 256 characters'],
    ['a row whose id is too long', row({ id: 'x'.repeat(PALETTE_LIMITS.id + 1) }), 'row 0: id is not a non-empty string of at most 256 characters'],
    ['a row with no label', row({ label: undefined }), 'row "w:one": label is not a non-empty string of at most 120 characters'],
    ['a row with a label that is only white space', row({ label: ' \n ' }), 'row "w:one": label is not a non-empty string of at most 120 characters'],
    ['a row with a label that is too long', row({ label: 'x'.repeat(PALETTE_LIMITS.label + 1) }), 'row "w:one": label is not a non-empty string of at most 120 characters'],
    ['a row whose secondary text is not text', row({ secondary: 3 }), 'row "w:one": secondary is not a string of at most 160 characters'],
    ['a row whose secondary text is too long', row({ secondary: 'x'.repeat(PALETTE_LIMITS.secondary + 1) }), 'row "w:one": secondary is not a string of at most 160 characters'],
    ['a row whose keywords are too long', row({ keywords: 'x'.repeat(PALETTE_LIMITS.keywords + 1) }), 'row "w:one": keywords is not a string of at most 200 characters'],
    ['a row with no glyph', row({ icon: undefined }), 'row "w:one": icon is not a glyph name'],
    ['a row whose glyph is not a name', row({ icon: 3 }), 'row "w:one": icon is not a glyph name'],
    ['a row whose glyph the kit does not have', row({ icon: 'no-such-glyph' }), 'row "w:one": the glyph "no-such-glyph" is not one the kit has'],
    ['a row that opens nothing', row({ route: undefined }), 'row "w:one": it opens neither a route nor a command'],
    ['a row that opens two things', row({ command: { id: 'reset' } }), 'row "w:one": it names both a route and a command: it opens one thing'],
    ['a row that holds a function: a row is data, and a function that draws is not one', row({ render: () => null }), 'row "w:one": "render" is a function, and a row is data'],
    ['a route that is not an object', row({ route: 'widgets' }), 'row "w:one": route is not an object'],
    ['a route to a page the plugin does not have (another plugin\'s page, or none)', row({ route: { page: 'gadgets', params: {} } }), 'row "w:one": route.page "gadgets" is not one of the plugin\'s pages'],
    ['a route whose page is a member the prototype brings', row({ route: { page: 'constructor', params: {} } }), 'row "w:one": route.page "constructor" is not one of the plugin\'s pages'],
    ['a route with no page', row({ route: { params: {} } }), 'row "w:one": route.page is not text'],
    ['a route whose connection is not text', row({ route: { page: 'widgets', connection: 3, params: {} } }), 'row "w:one": route.connection is not a string of at most 256 characters'],
    ['a route whose connection is too long', row({ route: { page: 'widgets', connection: 'x'.repeat(PALETTE_LIMITS.connection + 1), params: {} } }), 'row "w:one": route.connection is not a string of at most 256 characters'],
    ['a route whose parameters are not an object', row({ route: { page: 'widgets', params: [] } }), 'row "w:one": route.params is not an object'],
    ['a route with no parameters member', row({ route: { page: 'widgets' } }), 'row "w:one": route.params is not an object'],
    ['a list page given a parameter', row({ route: { page: 'widgets', params: { name: 'a' } } }), 'row "w:one": route.page "widgets" is a list page and takes no parameters'],
    ['an overview page given a parameter', row({ route: { page: 'overview', params: { name: 'a' } } }), 'row "w:one": route.page "overview" is an overview page and takes no parameters'],
    ['a custom page given a parameter', row({ route: { page: 'landing', params: { name: 'a' } } }), 'row "w:one": route.page "landing" is a custom page and takes no parameters'],
    ['a detail page without the parameter that names its object', row({ route: { page: 'widget', params: {} } }), 'row "w:one": route.page "widget" is a detail page and needs the parameter "name"'],
    ['a detail page whose object is named by blank text', row({ route: { page: 'widget', params: { name: ' ' } } }), 'row "w:one": route.page "widget" is a detail page and needs the parameter "name"'],
    ['a parameter that is not text', row({ route: { page: 'widget', params: { name: 3 } } }), 'row "w:one": route.params.name is not a string of at most 256 characters'],
    ['a parameter value that is too long', row({ route: { page: 'widget', params: { name: 'x'.repeat(PALETTE_LIMITS.paramValue + 1) } } }), 'row "w:one": route.params.name is not a string of at most 256 characters'],
    ['a parameter name that is too long', row({ route: { page: 'widget', params: { name: 'a', [`p${'x'.repeat(PALETTE_LIMITS.paramName)}`]: 'b' } } }), 'row "w:one": route.params has a name of more than 64 characters'],
    ['more parameters than a route may have', row({ route: { page: 'widget', params: { name: 'a', a: '1', b: '1', c: '1', d: '1', e: '1', f: '1', g: '1', h: '1' } } }), 'row "w:one": route.params has 9 parameters, at most 8'],
    ['a connection written as a parameter: it is the route\'s own member', row({ route: { page: 'widget', params: { name: 'a', connection: 'north' } } }), 'row "w:one": route.params holds "connection": it is the route\'s own member'],
    ['a command that is not an object', row({ route: undefined, command: 'reset' }), 'row "w:one": command is not an object'],
    ['a command the plugin does not have', row({ route: undefined, command: { id: 'launch' } }), 'row "w:one": command.id "launch" is not one of the plugin\'s commands'],
    ['a command whose id is a member the prototype brings', row({ route: undefined, command: { id: 'constructor' } }), 'row "w:one": command.id "constructor" is not one of the plugin\'s commands'],
    ['a command argument that is not JSON', row({ route: undefined, command: { id: 'reset', arg: () => 1 } }), 'row "w:one": command.arg is not JSON of at most 1024 characters'],
    ['a command argument that is not finite', row({ route: undefined, command: { id: 'reset', arg: Number.NaN } }), 'row "w:one": command.arg is not JSON of at most 1024 characters'],
    ['a command argument that is too long', row({ route: undefined, command: { id: 'reset', arg: 'x'.repeat(PALETTE_LIMITS.arg) } }), 'row "w:one": command.arg is not JSON of at most 1024 characters'],
  ])('leaves out %s, and says why', (_name, raw, expected) => {
    expect(problemOf(raw)).toBe(expected);
  });

  it('says a row that has no usable id by its place in the answer', () => {
    expect(admitRow(row({ id: undefined }), rules, 7)).toEqual({ ok: false, problem: 'row 7: id is not a non-empty string of at most 256 characters' });
  });

  it('refuses every glyph the kit does not have and admits one it does', () => {
    expect(problemOf(row({ icon: 'box' }))).toBeUndefined();
    expect(problemOf(row({ icon: 'Box' }))).toBe('row "w:one": the glyph "Box" is not one the kit has');
  });

  it('leaves out every route when the plugin has no pages at all: a route needs a page of the plugin, and a plugin with none has no route to offer', () => {
    expect(problemOf(row(), { pages: {}, commands: {} })).toBe('row "w:one": route.page "widgets" is not one of the plugin\'s pages');
  });

  it('does not run code of the plugin\'s beyond reading its members once: a getter is read once, and what it said is what was checked', () => {
    let reads = 0;
    const raw: Loose = { id: 'g', icon: 'box', route: { page: 'widgets', params: {} } };
    Object.defineProperty(raw, 'label', {
      enumerable: true,
      get: () => {
        reads += 1;
        return reads === 1 ? 'first' : 'x'.repeat(500);
      },
    });
    const admission = admitRow(raw, rules, 0);

    expect(reads).toBe(1);
    expect(admission.ok && admission.row.label).toBe('first');
  });
});

describe('admitRows', () => {
  const rowsOf = (count: number, patch: (index: number) => Loose = () => ({})): Loose[] => Array.from({ length: count }, (_, index) => row({ id: `w:${String(index)}`, label: `widget ${String(index)}`, ...patch(index) }));

  it('keeps the rows that are valid, in the order they were given, and says what became of each that was not', () => {
    const raw = [row({ id: 'a' }), row({ id: 'b', icon: 'nope' }), row({ id: 'c' }), 7];
    const read = admitRows(raw, rules, { keep: 20, scan: 100 });

    expect(read.rows.map((admitted) => admitted.id)).toEqual(['a', 'c']);
    expect(read.problems).toEqual(['row "b": the glyph "nope" is not one the kit has', 'row 3 is not an object']);
    expect(read.read).toBe(4);
  });

  it('leaves out a second row with an id it has already read, and says so', () => {
    const read = admitRows([row({ id: 'a' }), row({ id: 'a', label: 'again' })], rules, { keep: 20, scan: 100 });

    expect(read.rows.map((admitted) => admitted.label)).toEqual(['one']);
    expect(read.problems).toEqual(['row "a": the id is used twice in one answer']);
  });

  it('stops at the rows it keeps: the rest of a list of five thousand is not read, and `read` says how far it went', () => {
    const read = admitRows(rowsOf(5000), rules, { keep: 20, scan: 100 });

    expect(read.rows).toHaveLength(20);
    expect(read.read).toBe(20);
    expect(read.problems).toEqual([]);
  });

  it('stops at the rows it scans: an answer of rows that are all not valid is not read whole', () => {
    const read = admitRows(rowsOf(5000, () => ({ icon: 'nope' })), rules, { keep: 20, scan: 100 });

    expect(read.rows).toEqual([]);
    expect(read.read).toBe(100);
    expect(read.problems).toHaveLength(8);
    expect(read.problems.at(-1)).toBe('and 93 more rows that are not valid');
  });

  it('says at most eight problems, and counts the others', () => {
    const read = admitRows(rowsOf(12, () => ({ label: '' })), rules, { keep: 20, scan: 100 });

    expect(read.problems).toHaveLength(8);
    expect(read.problems.slice(0, 7).every((problem) => problem.includes('label is not a non-empty string'))).toBe(true);
    expect(read.problems[7]).toBe('and 5 more rows that are not valid');
  });
});
