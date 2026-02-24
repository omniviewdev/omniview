/**
 * NOTE: IMPORTANT!! ensure that before adding more here, that the externals are updated in the source plugin, and
 * vice versa. This is to ensure that the plugin is not bundled with the dependencies, and instead
 * will use the shared dependencies that are already loaded in the main app to prevent bloating the bundle size.
 */
export const shared = {
  // Material UI
  '@emotion/react': () => import('@emotion/react'),
  '@emotion/styled': () => import('@emotion/styled'),

  '@mui/material': () => import('@mui/material'),
  '@mui/material/utils': () => import('@mui/material/utils'),
  '@mui/material/styles': () => import('@mui/material/styles'),
  '@mui/material/Box': () => import('@mui/material/Box'),
  '@mui/material/Grid': () => import('@mui/material/Grid'),
  '@mui/material/GlobalStyles': () => import('@mui/material/GlobalStyles'),
  '@mui/material/CssBaseline': () => import('@mui/material/CssBaseline'),
  '@mui/material/CircularProgress': () => import('@mui/material/CircularProgress'),
  '@mui/material/LinearProgress': () => import('@mui/material/LinearProgress'),
  '@mui/material/Divider': () => import('@mui/material/Divider'),
  '@mui/icons-material': () => import('@mui/icons-material'),
  '@mui/x-charts': () => import('@mui/x-charts'),

  // @omniviewdev/ui design system
  '@omniviewdev/ui': () => import('@omniviewdev/ui'),
  '@omniviewdev/ui/buttons': () => import('@omniviewdev/ui/buttons'),
  '@omniviewdev/ui/inputs': () => import('@omniviewdev/ui/inputs'),
  '@omniviewdev/ui/feedback': () => import('@omniviewdev/ui/feedback'),
  '@omniviewdev/ui/typography': () => import('@omniviewdev/ui/typography'),
  '@omniviewdev/ui/overlays': () => import('@omniviewdev/ui/overlays'),
  '@omniviewdev/ui/navigation': () => import('@omniviewdev/ui/navigation'),
  '@omniviewdev/ui/table': () => import('@omniviewdev/ui/table'),
  '@omniviewdev/ui/layout': () => import('@omniviewdev/ui/layout'),
  '@omniviewdev/ui/domain': () => import('@omniviewdev/ui/domain'),
  '@omniviewdev/ui/charts': () => import('@omniviewdev/ui/charts'),
  '@omniviewdev/ui/editors': () => import('@omniviewdev/ui/editors'),
  '@omniviewdev/ui/types': () => import('@omniviewdev/ui/types'),
  '@omniviewdev/ui/theme': () => import('@omniviewdev/ui/theme'),
  '@omniviewdev/ui/menus': () => import('@omniviewdev/ui/menus'),
  '@omniviewdev/ui/sidebars': () => import('@omniviewdev/ui/sidebars'),
  '@omniviewdev/ui/cells': () => import('@omniviewdev/ui/cells'),

  // React
  'react': () => import('react'),
  'react/jsx-runtime': () => import('react/jsx-runtime'),
  'react/jsx-dev-runtime': () => import('react/jsx-dev-runtime'),
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

  // DND Kit
  '@dnd-kit/core': () => import('@dnd-kit/core'),
  '@dnd-kit/modifiers': () => import('@dnd-kit/modifiers'),
  '@dnd-kit/sortable': () => import('@dnd-kit/sortable'),
  '@dnd-kit/utilities': () => import('@dnd-kit/utilities'),

  // Utilities
  'date-fns': () => import('date-fns'),
  'yaml': () => import('yaml')
};
