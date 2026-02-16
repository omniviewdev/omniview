/**
 * NOTE: IMPORTANT!! ensure that before adding more here, that the externals are updated in the source plugin, and
 * vice versa. This is to ensure that the plugin is not bundled with the dependencies, and instead
 * will use the shared dependencies that are already loaded in the main app to prevent bloating the bundle size.
 */
export const shared = {
  // Material UI
  '@emotion/react': () => import('@emotion/react'),
  '@emotion/styled': () => import('@emotion/styled'),

  '@mui/joy': () => import('@mui/joy'),
  '@mui/joy/Table': () => import('@mui/joy/Table'),
  '@mui/joy/Typography': () => import('@mui/joy/Typography'),
  '@mui/joy/Sheet': () => import('@mui/joy/Sheet'),
  '@mui/joy/Stack': () => import('@mui/joy/Stack'),
  '@mui/joy/Box': () => import('@mui/joy/Box'),
  '@mui/joy/Card': () => import('@mui/joy/Card'),
  '@mui/joy/CardContent': () => import('@mui/joy/CardContent'),
  '@mui/joy/Divider': () => import('@mui/joy/Divider'),
  '@mui/joy/Grid': () => import('@mui/joy/Grid'),
  '@mui/joy/AccordionGroup': () => import('@mui/joy/AccordionGroup'),
  '@mui/joy/Accordion': () => import('@mui/joy/Accordion'),
  '@mui/joy/AccordionDetails': () => import('@mui/joy/AccordionDetails'),
  '@mui/joy/AccordionSummary': () => import('@mui/joy/AccordionSummary'),
  '@mui/joy/Avatar': () => import('@mui/joy/Avatar'),
  '@mui/joy/Chip': () => import('@mui/joy/Chip'),
  '@mui/joy/Tooltip': () => import('@mui/joy/Tooltip'),
  '@mui/joy/Button': () => import('@mui/joy/Button'),
  '@mui/joy/FormControl': () => import('@mui/joy/FormControl'),
  '@mui/joy/FormHelperText': () => import('@mui/joy/FormHelperText'),
  '@mui/joy/IconButton': () => import('@mui/joy/IconButton'),
  '@mui/joy/Input': () => import('@mui/joy/Input'),
  '@mui/joy/Textarea': () => import('@mui/joy/Textarea'),

  '@mui/base': () => import('@mui/base'),
  '@mui/base/Unstable_Popup': () => import('@mui/base/Unstable_Popup'),

  '@mui/material/utils': () => import('@mui/material/utils'),
  '@mui/x-charts': () => import('@mui/x-charts'),
  '@mui/material': () => import('@mui/material'),
  '@mui/icons-material': () => import('@mui/icons-material'),

  // React
  'react': () => import('react'),
  'react/jsx-runtime': () => import('react/jsx-runtime'),
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
