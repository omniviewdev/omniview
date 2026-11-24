import type { ContributionV1 } from '../../contract/v1';
import { PORTS_NAME } from './ports';
import { portsPage } from './ports-pages';

// The ports fixture's bundle (`fixture-g-ports`, build.mjs): a rail entry, a sidebar with one entry and one list page, whose row has the button that asks the host to forward a port (ports-pages.tsx). It is a bundle of its own,
// as the connections fixture's is, so the entry of the other fixture plugins carries nothing of it and what the seam's other scenarios read is what it was.

export const contributionV1 = {
  plugin: { name: PORTS_NAME, accent: 'blue' },
  rail: { icon: 'server', label: PORTS_NAME, order: 40 },
  sidebar: {
    label: 'Seam Ports navigation',
    title: 'Ports',
    nodes: [{ id: 'things', label: 'Things', icon: 'layers', children: [{ id: 'targets', label: 'Targets', icon: 'box' }] }],
  },
  pages: { targets: portsPage },
  home: 'targets',
} satisfies ContributionV1;
