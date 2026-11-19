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
 * The mock's second plugin screen, whose rail is the reference of the rail's glyph (ch12 section 4 and `railHtml()` of the mock's core.js: 20 px glyphs, the open tool marked `open` and
 * `aria-current`, tips opening to the right at once): its home, opened in a freshly loaded page. The first screen's rail (`MOCK_OPEN`) draws 16 px glyphs at the same centres.
 */
export const MOCK_OPEN_RAIL = `Shell.tabs.open({ plugin: 'aws', route: { page: 'home' } }, { how: 'here' });`;

/**
 * What the shell registers for that screen, with the mock's own words: the widths of the reference's text (the tab, the scope faces, the path) are the widths of these words, so
 * the shell can only be compared with the mock when it draws them. The shell probe injects this object into its neutral fixture before the page runs (`window.__registration`,
 * fixture.tsx `?case=injected`): the fixture, the shell and the probe's script name no plugin, and the words stay in this folder.
 */
export const MOCK_REGISTRATION = {
  plugin: { name: 'Kubernetes' },
  tab: { title: 'Pods', icon: 'box' },
  path: ['Kubernetes', 'prod-eu', 'Pods'],
  // The mock's Kubernetes rail has three tools (shell-kubernetes.js:286: Open Kubernetes, Open connections, Open connection settings). The shell's rail has one entry per plugin; three entries
  // give the same three targets, one under the other, to compare the stack with.
  rail: {
    label: 'Plugins',
    entries: [
      { id: 'kubernetes', label: 'Kubernetes', icon: 'layers' },
      { id: 'aws', label: 'AWS', icon: 'box' },
      { id: 'flux', label: 'Flux', icon: 'server' },
    ],
    current: 'kubernetes',
  },
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

/**
 * A script that opens tabs 2..n through the mock's own tab model, in addition to the one MOCK_OPEN opened: each is a different list page of the mock's
 * resource definitions (so no tab dedupes), opened with `how: 'new'`. Evaluated in the page; returns the number of tabs it opened.
 */
export const MOCK_OPEN_TABS = (count) => `
  (() => {
    const scope = K8s.connections.defaultScope('prod-eu');
    const types = K8s.resourceDefinitions.list().map((definition) => definition.type ?? definition.id ?? definition.logicalType);
    const wanted = types.slice(1, ${Number(count)});
    for (const logicalType of wanted) {
      Shell.tabs.open({ plugin: 'kubernetes', route: K8s.route.make('k8s-resources', { logicalType }, scope), scope }, { how: 'new' });
    }
    return wanted.length;
  })()
`;
