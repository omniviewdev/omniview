/**
 * NOTE: IMPORTANT!! ensure that before adding more here, that the externals are updated in the source plugin, and
 * vice versa. This is to ensure that the plugin is not bundled with the dependencies, and instead
 * will use the shared dependencies that are already loaded in the main app to prevent bloating the bundle size.
 */
export const shared = {
  // React
  'react': () => import('react'),
  'react/jsx-runtime': () => import('react/jsx-runtime'),
  'react/compiler-runtime': () => import('react/compiler-runtime'),
  'react/jsx-dev-runtime': async () => {
    // In production builds, import('react/jsx-dev-runtime') may be replaced
    // with the production jsx-runtime (no jsxDEV). Since dev-mode plugins
    // need jsxDEV, we construct it from the production jsx/jsxs + Fragment.
    const mod = await import('react/jsx-dev-runtime');
    if (typeof mod.jsxDEV === 'function') return mod;
    const prodRuntime = await import('react/jsx-runtime');
    return {
      ...prodRuntime,
      jsxDEV: (type: any, props: any, key: any, _isStatic: any, _source: any, _self: any) =>
        key !== undefined ? prodRuntime.jsx(type, { ...props, key }) : prodRuntime.jsx(type, props),
    };
  },
  'react-router-dom': () => import('react-router-dom'),
  'react-dom': () => import('react-dom'),
  'react-icons': () => import('react-icons'),
  'react-icons/lu': () => import('react-icons/lu'),
  'react-icons/si': () => import('react-icons/si'),

  // Monaco
  'monaco-editor': () => import('monaco-editor'),
  'monaco-types': () => import('monaco-types'),
  'monaco-yaml': () => import('monaco-yaml'),
  '@monaco-editor/react': () => import('@monaco-editor/react'),

  // Tanstack
  '@tanstack/react-query': () => import('@tanstack/react-query'),
  '@tanstack/react-table': () => import('@tanstack/react-table'),
  '@tanstack/react-virtual': () => import('@tanstack/react-virtual'),

  // Omniview
  '@omniviewdev/runtime': () => import('@omniviewdev/runtime'),
  '@omniviewdev/runtime/api': () => import('@omniviewdev/runtime/api'),
  '@omniviewdev/runtime/runtime': () => import('@omniviewdev/runtime/runtime'),
  '@omniviewdev/runtime/models': () => import('@omniviewdev/runtime/models'),

  // @omniviewdev npm packages (base-ui, ai-ui, editors)
  '@omniviewdev/base-ui': () => import('@omniviewdev/base-ui'),
  '@omniviewdev/base-ui/styles.css': () => import('@omniviewdev/base-ui/styles.css'),
  '@omniviewdev/ai-ui': () => import('@omniviewdev/ai-ui'),
  '@omniviewdev/ai-ui/styles.css': () => import('@omniviewdev/ai-ui/styles.css'),
  '@omniviewdev/editors': () => import('@omniviewdev/editors'),
  '@omniviewdev/editors/styles.css': () => import('@omniviewdev/editors/styles.css'),

  // DND Kit
  '@dnd-kit/core': () => import('@dnd-kit/core'),
  '@dnd-kit/modifiers': () => import('@dnd-kit/modifiers'),
  '@dnd-kit/sortable': () => import('@dnd-kit/sortable'),
  '@dnd-kit/utilities': () => import('@dnd-kit/utilities'),

  // Utilities
  'date-fns': () => import('date-fns'),
  'yaml': () => import('yaml')
};
