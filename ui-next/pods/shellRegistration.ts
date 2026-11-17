// What the Pods screen tells the shell about itself (the slice plan, PR 1a.5): the entries of the sidebar tree, the scope lane,
// the tab and the path, as plain data. The shell is plugin-agnostic: it knows this object only by its shape, which `ui-next/shell/registration.ts`
// declares and `ui-next/main.tsx` checks where the two meet. This file imports nothing from the shell, as the Kubernetes plugin will not.
//
// Throwaway scaffolding, like the rest of this directory: the plugin's own stream replaces it. A value the page learns from its data (the
// count of Pods, the connection it picked) reaches the shell through this object when the page that owns the data is wired to it (PR 1a.7);
// until then the count is absent and the connection is the one the URL names. The page is a collection view that owns its scrolling, so it
// registers the shell's `pane` layout (the mock's `AWS.page(..., { layout: 'pane' })`).

/** `connection` is the connection the URL names (`?connection=`); without one the lane and the path have no connection to show. */
export function podsShellRegistration(connection: string | undefined) {
  return {
    plugin: { name: 'Kubernetes' },
    tab: { title: 'Pods', icon: 'box' },
    path: connection === undefined ? ['Kubernetes', 'Pods'] : ['Kubernetes', connection, 'Pods'],
    rail: true,
    layout: 'pane',
    sidebar: {
      label: 'Kubernetes resources',
      title: 'Resources',
      nodes: [{ id: 'workloads', label: 'Workloads', icon: 'layers', children: [{ id: 'pods', label: 'Pods', icon: 'box' }] }],
      open: ['workloads'],
      current: 'pods',
      accent: 'blue',
    },
    scope:
      connection === undefined
        ? undefined
        : ([
          { label: 'Connection', icon: 'server', text: connection },
          { label: 'Namespaces', icon: 'folder-tree', text: 'All namespaces' },
        ] as const),
  } as const;
}

/** What the Pods screen registers: the page that builds a value of this shape hands it to the shell, whose own type checks it at the mount point. */
export type PodsShellRegistration = ReturnType<typeof podsShellRegistration>;
