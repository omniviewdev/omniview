import { describe, expect, it } from 'vitest';
import { ContractError } from '../loader/failure';
import { admit, admitOrThrow, openable, CONTRIBUTION_EXPORT_V1 } from './admit';
import type { SidebarNodeV1 } from './v1';

// Admission reads what a bundle hands the host as `unknown`. Each test breaks one thing in an otherwise good contribution, and the problem must name it:
// that is what a plugin author reads in the log. The names are invented (Acme, widgets); the host knows no plugin.

type Loose = Record<string, unknown>;

const definition = (patch: Loose = {}): Loose => ({
  title: 'Widgets',
  nouns: { one: 'Widget', other: 'Widgets' },
  columns: [{ id: 'name' }],
  lines: 1,
  getRowKey: () => 'k',
  searchText: () => 't',
  ...patch,
});

const page = (patch: Loose = {}): Loose => ({ kind: 'list', definition: definition(), usePage: () => ({}), ...patch });

const sidebar = (patch: Loose = {}): Loose => ({
  label: 'Acme navigation',
  title: 'Acme',
  nodes: [{ id: 'group', label: 'Group', icon: 'layers', children: [{ id: 'widgets', label: 'Widgets', icon: 'box', count: 3 }] }],
  useNodes: () => undefined,
  ...patch,
});

/** A good contribution, with `patch` laid over its top-level fields. */
const contribution = (patch: Loose = {}): Loose => ({
  plugin: { name: 'Acme', accent: 'blue' },
  rail: true,
  sidebar: sidebar(),
  pages: { widgets: page() },
  home: 'widgets',
  ...patch,
});

const exportsOf = (value: unknown): Loose => ({ [CONTRIBUTION_EXPORT_V1]: value });

const problemsOf = (value: Loose): readonly string[] => {
  const admission = admit(exportsOf(value));
  return admission.ok ? [] : admission.problems;
};

describe('admit', () => {
  it('admits a good contribution and hands back the plugin\'s own object', () => {
    const value = contribution();
    const admission = admit(exportsOf(value));

    expect(admission.ok).toBe(true);
    expect(admission.ok && admission.contribution).toBe(value);
  });

  it('admits a contribution with the fewest fields: no rail, no accent, no hook', () => {
    const { rail: _rail, ...rest } = contribution({ plugin: { name: 'Acme' }, sidebar: sidebar({ useNodes: undefined }) });

    expect(admit(exportsOf(rest)).ok).toBe(true);
  });

  it('refuses a bundle that exports no contribution of this version, and names the export', () => {
    expect(admit({ plugin: {} })).toEqual({ ok: false, problems: ['the bundle exports no contributionV1'] });
    expect(admit(undefined)).toEqual({ ok: false, problems: ['the bundle exports no contributionV1'] });
    expect(admit(exportsOf('text'))).toEqual({ ok: false, problems: ['contributionV1 is not an object'] });
  });

  it.each([
    ['a plugin without a name', contribution({ plugin: { name: ' ' } }), 'plugin.name is not a non-empty string'],
    ['a colour the shell does not have', contribution({ plugin: { name: 'Acme', accent: 'chartreuse' } }), 'plugin.accent "chartreuse" is not one of the shell\'s colours'],
    ['a rail that is not an entry', contribution({ rail: 1 }), 'rail is neither absent, true, nor an entry'],
    ['a sidebar without a title', contribution({ sidebar: sidebar({ title: '' }) }), 'sidebar needs a label and a title'],
    ['a sidebar hook that is not a function', contribution({ sidebar: sidebar({ useNodes: 'yes' }) }), 'sidebar.useNodes is not a function'],
    ['a home that is not a page', contribution({ home: 'gadgets' }), 'home "gadgets" is not one of the pages'],
    ['no pages', contribution({ pages: {} }), 'pages is not an object with a page in it'],
    ['a page of a kind this version does not draw', contribution({ pages: { widgets: page({ kind: 'dashboard' }) } }), 'pages.widgets.kind is "dashboard", and this version draws "list" and "detail" pages'],
    ['a page without a data hook', contribution({ pages: { widgets: page({ usePage: undefined }) } }), 'pages.widgets.usePage is not a function'],
    ['a page without a title', contribution({ pages: { widgets: page({ definition: definition({ title: '' }) }) } }), 'pages.widgets.definition.title is not a non-empty string'],
    ['a page without nouns', contribution({ pages: { widgets: page({ definition: definition({ nouns: { one: 'Widget' } }) }) } }), 'pages.widgets.definition.nouns needs "one" and "other"'],
    ['a page without columns', contribution({ pages: { widgets: page({ definition: definition({ columns: [] }) }) } }), 'pages.widgets.definition.columns is not a list with a column in it'],
    ['a page with three lines to a row', contribution({ pages: { widgets: page({ definition: definition({ lines: 3 }) }) } }), 'pages.widgets.definition.lines is not 1 or 2'],
    ['a page without a row key', contribution({ pages: { widgets: page({ definition: definition({ getRowKey: undefined }) }) } }), 'pages.widgets.definition needs getRowKey and searchText functions'],
  ])('refuses %s', (_name, value, expected) => {
    expect(problemsOf(value)).toContain(expected);
  });

  it('refuses a sidebar entry that opens no page: a stub entry is not shipped', () => {
    const value = contribution({ sidebar: sidebar({ nodes: [{ id: 'orphan', label: 'Orphan', icon: 'box' }] }) });

    expect(problemsOf(value)).toContain('the sidebar entry "orphan" opens no page');
  });

  it('refuses two nodes with one id, and a node with no label or icon', () => {
    const value = contribution({
      sidebar: sidebar({
        nodes: [
          { id: 'widgets', label: 'Widgets', icon: 'box' },
          { id: 'widgets', label: '', icon: '' },
        ],
      }),
    });

    expect(problemsOf(value)).toEqual(
      expect.arrayContaining(['sidebar.nodes[1].id "widgets" is used twice', 'sidebar.nodes[1].label is not a non-empty string', 'sidebar.nodes[1].icon is not a glyph name']),
    );
  });

  it('refuses a count that is not a number', () => {
    const value = contribution({ sidebar: sidebar({ nodes: [{ id: 'widgets', label: 'Widgets', icon: 'box', count: '3' }] }) });

    expect(problemsOf(value)).toContain('sidebar.nodes[0].count is not a number');
  });

  it('reports at most eight problems, enough to fix a bundle', () => {
    const admission = admit(exportsOf({ plugin: {}, sidebar: { nodes: Array.from({ length: 30 }, () => ({})) }, pages: {}, home: 1 }));

    expect(!admission.ok && admission.problems).toHaveLength(8);
  });

  it('refuses a page keyed $home, the id the host reads as the plugin\'s home page: such a page could not be opened', () => {
    expect(problemsOf(contribution({ pages: { widgets: page(), $home: page() } }))).toEqual(['pages.$home is reserved for the home page of the plugin']);
  });
});

describe('admitOrThrow', () => {
  it('throws the problems as one contract error', () => {
    const attempt = () => admitOrThrow(exportsOf({ plugin: { name: 'Acme' } }));

    expect(attempt).toThrow(ContractError);
    expect(attempt).toThrow(/sidebar is not an object/);
  });
});

describe('openable', () => {
  const nodes: readonly SidebarNodeV1[] = [
    { id: 'group', label: 'Group', icon: 'layers', children: [{ id: 'widgets', label: 'Widgets', icon: 'box' }, { id: 'ghost', label: 'Ghost', icon: 'box' }] },
    { id: 'empty', label: 'Empty', icon: 'layers', children: [{ id: 'ghost2', label: 'Ghost', icon: 'box' }] },
    { id: 'gadgets', label: 'Gadgets', icon: 'box' },
  ];

  it('keeps the entries that open a page, the groups that still hold one, and drops the rest', () => {
    expect(openable(nodes, { widgets: {}, gadgets: {} })).toEqual([
      { id: 'group', label: 'Group', icon: 'layers', children: [{ id: 'widgets', label: 'Widgets', icon: 'box' }] },
      { id: 'gadgets', label: 'Gadgets', icon: 'box' },
    ]);
  });
});

// The detail page was added to contract version 1 as a minor addition (the rule is written at the head of `v1.ts`): what a bundle written before it said is read as before, and
// what a host that lacks it would meet is a refusal by name. These tests hold both halves.
const detailDefinition = (patch: Loose = {}): Loose => ({
  kind: 'Widget',
  tile: { icon: 'box', tone: 'blue' },
  identity: { name: 'name', facets: ['bay'] },
  list: { page: 'widgets', label: 'Widgets' },
  tabs: [{ id: 'overview', label: 'Overview' }],
  ...patch,
});

const detailPage = (patch: Loose = {}): Loose => ({ kind: 'detail', definition: detailDefinition(), usePage: () => ({}), ...patch });

describe('admit: the detail page (a minor addition to version 1)', () => {
  it('admits a contribution with a detail page beside its list page', () => {
    const value = contribution({ pages: { widgets: page(), widget: detailPage() } });

    expect(admit(exportsOf(value)).ok).toBe(true);
  });

  it('still admits, unchanged, a contribution written before the detail page existed: list pages only, no route parameters, no member this host added', () => {
    // The shape the first version said, frozen: nothing of the detail page in it.
    const before: Loose = {
      plugin: { name: 'Acme', accent: 'blue' },
      rail: true,
      sidebar: { label: 'Acme navigation', title: 'Acme', nodes: [{ id: 'widgets', label: 'Widgets', icon: 'box' }] },
      pages: { widgets: { kind: 'list', definition: definition(), usePage: () => ({}) } },
      home: 'widgets',
    };
    const admission = admit(exportsOf(before));

    expect(admission.ok).toBe(true);
    expect(admission.ok && admission.contribution).toBe(before);
  });

  it('words a kind this version does not draw with both kinds it does', () => {
    expect(problemsOf(contribution({ pages: { widgets: page({ kind: 'dashboard' }) } }))).toContain('pages.widgets.kind is "dashboard", and this version draws "list" and "detail" pages');
  });

  it.each([
    ['a detail page without a kind of object', detailPage({ definition: detailDefinition({ kind: '' }) }), 'pages.widget.definition.kind is not a non-empty string'],
    ['a detail page without a tile', detailPage({ definition: detailDefinition({ tile: {} }) }), 'pages.widget.definition.tile needs an icon'],
    ['a detail page that names no parameter for the object', detailPage({ definition: detailDefinition({ identity: {} }) }), 'pages.widget.definition.identity needs a name: the route parameter that holds it'],
    ['facets that are not parameter names', detailPage({ definition: detailDefinition({ identity: { name: 'name', facets: ['bay', 4] } }) }), 'pages.widget.definition.identity.facets is not a list of parameter names'],
    ['a list that names no page', detailPage({ definition: detailDefinition({ list: { label: 'Widgets' } }) }), 'pages.widget.definition.list needs a page and a label'],
    ['a list that is not a list page of the contribution', detailPage({ definition: detailDefinition({ list: { page: 'gadgets', label: 'Gadgets' } }) }), 'pages.widget.definition.list.page "gadgets" is not a list page of this contribution'],
    ['a list that is a detail page itself', detailPage({ definition: detailDefinition({ list: { page: 'widget', label: 'Widget' } }) }), 'pages.widget.definition.list.page "widget" is not a list page of this contribution'],
    ['no tabs', detailPage({ definition: detailDefinition({ tabs: [] }) }), 'pages.widget.definition.tabs is not a list with a tab in it'],
    ['a tab without a label', detailPage({ definition: detailDefinition({ tabs: [{ id: 'overview' }] }) }), 'pages.widget.definition.tabs[0] needs an id and a label'],
    ['two tabs with one id', detailPage({ definition: detailDefinition({ tabs: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] }) }), 'pages.widget.definition.tabs[1].id "a" is used twice'],
    ['a detail page without a data hook', detailPage({ usePage: undefined }), 'pages.widget.usePage is not a function'],
  ])('refuses %s', (_name, widget, expected) => {
    expect(problemsOf(contribution({ pages: { widgets: page(), widget } }))).toContain(expected);
  });

  it('accepts a detail page with no list: nothing to lead back to', () => {
    const value = contribution({ pages: { widgets: page(), widget: detailPage({ definition: detailDefinition({ list: undefined }) }) } });

    expect(admit(exportsOf(value)).ok).toBe(true);
  });

  it('refuses a home that is a detail page, and a sidebar entry that opens one: both need an object the window does not have', () => {
    const value = contribution({
      pages: { widgets: page(), widget: detailPage() },
      home: 'widget',
      sidebar: sidebar({ nodes: [{ id: 'widget', label: 'Widget', icon: 'box' }] }),
    });

    expect(problemsOf(value)).toEqual(
      expect.arrayContaining(['the sidebar entry "widget" opens a detail page, which needs an object', 'home "widget" is a detail page, which needs an object: the window could not open it']),
    );
  });

  it('does not offer a detail page as an entry the sidebar\'s data hook answered', () => {
    const nodes: readonly SidebarNodeV1[] = [
      { id: 'widgets', label: 'Widgets', icon: 'box' },
      { id: 'widget', label: 'Widget', icon: 'box' },
    ];

    expect(openable(nodes, { widgets: page(), widget: detailPage() })).toEqual([{ id: 'widgets', label: 'Widgets', icon: 'box' }]);
  });
});

// The rail entry (S2a) is the other minor addition to version 1 (the rule is at the head of `v1.ts`). Its first half: what a bundle written before it said, `rail: true` or no rail, is
// read as before. Its second half: the shape it adds is refused by name when it is wrong. A host without it refuses any bundle that writes an entry, because it reads `rail` only as
// absent or `true` (`rail is neither absent nor true`, the check this file replaced).
describe('admit: the rail entry (a minor addition to version 1)', () => {
  it('admits an entry with a glyph, a name and a place, an entry with a glyph alone, and `true`', () => {
    for (const rail of [{ icon: 'layers', label: 'Acme tools', order: 20 }, { icon: 'layers' }, true, undefined]) {
      expect(admit(exportsOf(contribution({ rail }))).ok).toBe(true);
    }
  });

  it('admits a bundle written before the entry, with `rail: true` and with no rail, and hands back its own object', () => {
    const withTrue = contribution();
    const { rail: _rail, ...without } = contribution();

    expect(admit(exportsOf(withTrue))).toMatchObject({ ok: true, contribution: withTrue });
    expect(admit(exportsOf(without))).toMatchObject({ ok: true, contribution: without });
  });

  it.each([
    ['an entry with no glyph', { label: 'Acme' }, 'rail.icon is not a glyph name'],
    ['an entry whose glyph is not a name', { icon: 3 }, 'rail.icon is not a glyph name'],
    ['an entry whose name is blank', { icon: 'layers', label: ' ' }, 'rail.label is not a non-empty string'],
    ['an entry whose place is not a number', { icon: 'layers', order: 'first' }, 'rail.order is not a finite number'],
    ['an entry whose place is not finite', { icon: 'layers', order: Number.POSITIVE_INFINITY }, 'rail.order is not a finite number'],
    ['a rail that is a list', [], 'rail is neither absent, true, nor an entry'],
    ['a rail that is false', false, 'rail is neither absent, true, nor an entry'],
  ])('refuses %s', (_name, rail, expected) => {
    expect(problemsOf(contribution({ rail }))).toContain(expected);
  });
});

// The panel (P1a, a minor addition to version 1): tools a plugin brings to the bottom panel, and how the sessions it opens in a tool of the host read. Admission checks the shape the host
// draws from; what a body or a card does is the boundary's.
describe('admit: the panel (a minor addition to version 1)', () => {
  const tool = (patch: Loose = {}): Loose => ({ label: 'Metrics', icon: 'box', order: 30, Body: () => null, ...patch });
  const withPanel = (panel: unknown) => contribution({ panel });

  it('admits a tool with its words, its glyph, its place and its body; with a card and a way to start a session', () => {
    for (const panel of [
      { tools: { metrics: tool() } },
      { tools: { metrics: tool({ order: undefined }) } },
      { tools: { metrics: tool({ card: () => undefined, newSession: { label: 'New stream', open: () => undefined } }) } },
      { tools: { metrics: tool(), other: tool({ label: 'Other' }) } },
      { sessions: { logs: { card: () => undefined } } },
      { sessions: { logs: {} } },
      { tools: { metrics: tool() }, sessions: { logs: { card: () => undefined } } },
      {},
      { tools: {} },
    ]) {
      expect(problemsOf(withPanel(panel)), JSON.stringify(Object.keys(panel))).toEqual([]);
    }
  });

  it('admits a bundle written before the panel, with no panel at all, and hands back its own object', () => {
    const value = contribution();
    expect(Object.hasOwn(value, 'panel')).toBe(false);
    expect(admit(exportsOf(value))).toMatchObject({ ok: true, contribution: value });
    expect(admit(exportsOf(withPanel(undefined))).ok).toBe(true);
  });

  it.each([
    ['a panel that is not an object', 3, 'panel is not an object'],
    ['a panel that is a list', [], 'panel is not an object'],
    ['tools that are a list', { tools: [] }, 'panel.tools is not an object'],
    ['a tool that is not an object', { tools: { metrics: 3 } }, 'panel.tools.metrics is not an object'],
    ['a tool with no label', { tools: { metrics: tool({ label: ' ' }) } }, 'panel.tools.metrics.label is not a non-empty string'],
    ['a tool with no glyph', { tools: { metrics: tool({ icon: undefined }) } }, 'panel.tools.metrics.icon is not a glyph name'],
    ['a tool whose place is not finite', { tools: { metrics: tool({ order: Number.NaN }) } }, 'panel.tools.metrics.order is not a finite number'],
    ['a tool with no body', { tools: { metrics: tool({ Body: undefined }) } }, 'panel.tools.metrics.Body is not a function'],
    ['a tool whose card is not a function', { tools: { metrics: tool({ card: {} }) } }, 'panel.tools.metrics.card is not a function'],
    ['a tool whose way to start a session has no words', { tools: { metrics: tool({ newSession: { open: () => undefined } }) } }, 'panel.tools.metrics.newSession needs a label and an open function'],
    ['a tool whose way to start a session cannot open', { tools: { metrics: tool({ newSession: { label: 'New' } }) } }, 'panel.tools.metrics.newSession needs a label and an open function'],
    ['a tool id with a colon (the host makes the id the panel knows it by, with the plugin before it)', { tools: { 'a:b': tool() } }, 'panel.tools.a:b is not a tool id: no colon, not empty'],
    ['sessions that are a list', { sessions: [] }, 'panel.sessions is not an object'],
    ['a session kind that is not an object', { sessions: { logs: 3 } }, 'panel.sessions.logs is not an object'],
    ['a session card that is not a function', { sessions: { logs: { card: 'x' } } }, 'panel.sessions.logs.card is not a function'],
  ])('refuses %s', (_name, panel, expected) => {
    expect(problemsOf(withPanel(panel))).toContain(expected);
  });

  it('allows a plugin two tools of its own, and refuses a third (ch16 S114: a plugin-specific tool needs the owner\'s approval and stays under the limit of two; the mock\'s harness: "panelTools limit is 2")', () => {
    expect(problemsOf(withPanel({ tools: { a: tool(), b: tool() } }))).toEqual([]);
    expect(problemsOf(withPanel({ tools: { a: tool(), b: tool(), c: tool() } }))).toContain('panel.tools has 3 tools: a plugin brings at most 2');
  });
});
