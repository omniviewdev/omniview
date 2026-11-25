import { useConnections } from '@omniviewdev/runtime/ui/v1';
import type { ContributionV1 } from '../../contract/v1';
import { connectionItemsPage, connectionOverviewPage } from './connection-pages';

// The connections fixture's bundle (`fixture-f-conn`, build.mjs): a rail entry, a sidebar with the overview and one list page, and the pages themselves: the overview (HM3), which is the page a connection lands on and so the plugin's home, and a list that reads the plugin's
// two connections from its route. It is a bundle of its own, so the entry of the other fixture plugins carries nothing of it.

/** The entry this plugin has in the window's rail, written into the bundle by the build (`build.mjs`, `define`). */
declare const FIXTURE_RAIL: { readonly label: string; readonly order: number };

export const contributionV1 = {
  plugin: { name: 'Seam Connections', accent: 'blue' },
  rail: { icon: 'server', label: FIXTURE_RAIL.label, order: FIXTURE_RAIL.order },
  sidebar: {
    label: 'Seam Connections navigation',
    title: 'Connections',
    nodes: [
      { id: 'overview', label: 'Overview', icon: 'server' },
      { id: 'things', label: 'Things', icon: 'layers', children: [{ id: 'items', label: 'Items', icon: 'box' }] },
    ],
  },
  pages: { overview: connectionOverviewPage, items: connectionItemsPage },
  home: 'overview',
} satisfies ContributionV1;

/** The shared modules as this bundle received them: the check compares them with the host's. */
export const imports = { useConnections };
