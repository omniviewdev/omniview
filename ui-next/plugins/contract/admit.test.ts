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
    ['a rail that is not true', contribution({ rail: 1 }), 'rail is neither absent nor true'],
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
