import type { ContributionV1, ContextV1, ListPageV1, ListPageViewV1 } from './contract/v1';

// Test support: a good contribution of an invented plugin (Acme, widgets), built the way a bundle builds its own. Nothing but tests imports this.

export type Widget = { readonly key: string; readonly name: string };

export const WIDGETS: readonly Widget[] = [
  { key: 'a', name: 'alpha' },
  { key: 'b', name: 'beta' },
];

/** A page whose data hook is `use`; its title is `title`. */
export function widgetPage(title: string, use: (context: ContextV1) => ListPageViewV1<Widget>): ListPageV1<Widget> {
  return {
    kind: 'list',
    definition: {
      title,
      nouns: { one: title, other: title },
      columns: [{ id: 'name', header: 'Name', fit: 'flex', width: 160, text: (row) => row.name, cell: (row) => row.name }],
      lines: 1,
      getRowKey: (row) => row.key,
      searchText: (row) => row.name,
    },
    usePage: use,
  };
}

/** The hook of a page that answers `rows` as a finished read. */
export const answering =
  (rows: readonly Widget[], crumb = 'Widgets') =>
    (context: ContextV1): ListPageViewV1<Widget> => ({
      frame: {
        tab: { title: crumb, icon: 'box' },
        path: ['Acme', crumb],
        scope: [{ label: 'Connection', icon: 'server', text: context.route.connection ?? 'none' }],
      },
      source: { state: { kind: 'ready' }, rows, complete: true, refreshing: false, refresh: async () => undefined },
    });

export function acme(patch: Partial<ContributionV1> = {}): ContributionV1 {
  return {
    plugin: { name: 'Acme', accent: 'blue' },
    rail: true,
    sidebar: {
      label: 'Acme navigation',
      title: 'Acme',
      nodes: [
        {
          id: 'group',
          label: 'Group',
          icon: 'layers',
          children: [
            { id: 'widgets', label: 'Widgets', icon: 'box' },
            { id: 'gadgets', label: 'Gadgets', icon: 'box' },
          ],
        },
      ],
    },
    pages: { widgets: widgetPage('Widgets', answering(WIDGETS)), gadgets: widgetPage('Gadgets', answering([{ key: 'g', name: 'gizmo' }], 'Gadgets')) },
    home: 'widgets',
    ...patch,
  };
}
