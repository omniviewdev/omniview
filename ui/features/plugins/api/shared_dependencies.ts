/**
 * NOTE: IMPORTANT!! ensure that before adding more here, that the externals are updated in the source plugin, and
 * vice versa. This is to ensure that the plugin is not bundled with the dependencies, and instead
 * will use the shared dependencies that are already loaded in the main app to prevent bloating the bundle size.
 */
export const shared = {
  // React
  'react': async () => import('react'),
  'react/jsx-runtime': async () => import('react/jsx-runtime'),
  'react/compiler-runtime': async () => import('react/compiler-runtime'),
  'react/jsx-dev-runtime': async () => {
    // In production builds, import('react/jsx-dev-runtime') may be replaced
    // with the production jsx-runtime (no jsxDEV). Since dev-mode plugins
    // need jsxDEV, we construct it from the production jsx/jsxs + Fragment.
    const mod = await import('react/jsx-dev-runtime');
    if (typeof mod.jsxDEV === 'function') {
      return mod;
    }

    const prodRuntime = await import('react/jsx-runtime');
    return {
      ...prodRuntime,
      jsxDEV: (type: any, props: any, key: any, _isStatic: any, _source: any, _self: any) =>
        key !== undefined ? prodRuntime.jsx(type, { ...props, key }) : prodRuntime.jsx(type, props),
    };
  },
  'react-router-dom': async () => import('react-router-dom'),
  'react-dom': async () => import('react-dom'),
  'react-icons': async () => import('react-icons'),
  'react-icons/lu': async () => import('react-icons/lu'),
  'react-icons/si': async () => import('react-icons/si'),

  // Monaco
  'monaco-editor': async () => import('monaco-editor'),
  'monaco-types': async () => import('monaco-types'),
  'monaco-yaml': async () => import('monaco-yaml'),
  '@monaco-editor/react': async () => import('@monaco-editor/react'),

  // Tanstack
  '@tanstack/react-query': async () => import('@tanstack/react-query'),
  '@tanstack/react-table': async () => import('@tanstack/react-table'),
  '@tanstack/react-virtual': async () => import('@tanstack/react-virtual'),

  // Omniview
  '@omniviewdev/runtime': async () => import('@omniviewdev/runtime'),
  '@omniviewdev/runtime/api': async () => import('@omniviewdev/runtime/api'),
  '@omniviewdev/runtime/runtime': async () => import('@omniviewdev/runtime/runtime'),
  '@omniviewdev/runtime/models': async () => import('@omniviewdev/runtime/models'),

  // @omniviewdev npm packages (base-ui, ai-ui, editors)
  '@omniviewdev/base-ui': async () => import('@omniviewdev/base-ui'),
  '@omniviewdev/base-ui/styles.css': async () => import('@omniviewdev/base-ui/styles.css'),
  '@omniviewdev/ai-ui': async () => import('@omniviewdev/ai-ui'),
  '@omniviewdev/ai-ui/styles.css': async () => import('@omniviewdev/ai-ui/styles.css'),
  '@omniviewdev/editors': async () => import('@omniviewdev/editors'),
  '@omniviewdev/editors/styles.css': async () => import('@omniviewdev/editors/styles.css'),

  // DND Kit
  '@dnd-kit/core': async () => import('@dnd-kit/core'),
  '@dnd-kit/modifiers': async () => import('@dnd-kit/modifiers'),
  '@dnd-kit/sortable': async () => import('@dnd-kit/sortable'),
  '@dnd-kit/utilities': async () => import('@dnd-kit/utilities'),

  // Utilities
  'date-fns': async () => import('date-fns'),
  'yaml': async () => import('yaml'),
};
