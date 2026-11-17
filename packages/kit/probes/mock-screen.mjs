// The one screen of the design mock that the references of the shell (ui-next/shell/probes/mock-shell.json) are measured on: the mock's Kubernetes Pods list of
// connection `prod-eu`, opened as appendix B of docs/ui-next/slices/1a-pods-list.md opens it. These are the mock's own words (its API and its data keys). They stay
// with the recordings of the mock, which the vocabulary guard leaves alone (packages/kit/eslint/vocabulary.mjs), and the shell's probes name the screen only through
// this file: the shell and its probes are plugin-agnostic and open nothing of a plugin's.

/** The mock's route to the screen, evaluated in a freshly loaded mock page. */
export const MOCK_OPEN = `
  const scope = K8s.connections.defaultScope('prod-eu');
  Shell.tabs.open({ plugin: 'kubernetes', route: K8s.route.make('k8s-resources', { logicalType: 'k8s:/pods' }, scope), scope }, { how: 'here' });
`;

/** The mock's tree rows on that screen: the group, and the entry the screen is on. */
export const MOCK_GROUP = '.tree__row[data-key="group:workloads"]';
export const MOCK_ENTRY = '.tree__row[data-key="k8s:/pods"]';

/**
 * What the shell registers for that screen, with the mock's own words: the widths of the reference's text (the tab, the scope faces, the path) are the widths of these words, so
 * the shell can only be compared with the mock when it draws them. The shell probe injects this object into its neutral fixture before the page runs (`window.__registration`,
 * fixture.tsx `?case=injected`): the fixture, the shell and the probe's script name no plugin, and the words stay in this folder.
 */
export const MOCK_REGISTRATION = {
  plugin: { name: 'Kubernetes' },
  tab: { title: 'Pods', icon: 'box' },
  path: ['Kubernetes', 'prod-eu', 'Pods'],
  rail: true,
  layout: 'pane',
  sidebar: {
    label: 'Kubernetes resources',
    title: 'Resources',
    nodes: [{ id: 'workloads', label: 'Workloads', icon: 'layers', children: [{ id: 'pods', label: 'Pods', icon: 'box', count: 89 }] }],
    open: ['workloads'],
    current: 'pods',
    accent: 'blue',
  },
  scope: [
    { label: 'Connection', icon: 'server', text: 'prod-eu' },
    { label: 'Namespaces', icon: 'folder-tree', text: 'All namespaces' },
  ],
};
