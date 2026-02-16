/**
 * The canonical list of package names shared between the Omniview host app
 * and plugins. Every entry here corresponds to an entry in the host's
 * shared_dependencies.ts.
 *
 * IMPORTANT: Keep this list in sync with:
 *   /ui/features/plugins/api/shared_dependencies.ts
 *
 * After modifying this list, run:
 *   pnpm --filter @omniviewdev/vite-plugin generate-shims
 */
export const SHARED_PACKAGES: readonly string[] = [
  // Emotion
  '@emotion/react',
  '@emotion/styled',

  // MUI Joy
  '@mui/joy',
  '@mui/joy/Table',
  '@mui/joy/Typography',
  '@mui/joy/Sheet',
  '@mui/joy/Stack',
  '@mui/joy/Box',
  '@mui/joy/Card',
  '@mui/joy/CardContent',
  '@mui/joy/Divider',
  '@mui/joy/Grid',
  '@mui/joy/AccordionGroup',
  '@mui/joy/Accordion',
  '@mui/joy/AccordionDetails',
  '@mui/joy/AccordionSummary',
  '@mui/joy/Avatar',
  '@mui/joy/Chip',
  '@mui/joy/Tooltip',
  '@mui/joy/Button',
  '@mui/joy/FormControl',
  '@mui/joy/FormHelperText',
  '@mui/joy/IconButton',
  '@mui/joy/Input',
  '@mui/joy/Textarea',

  // MUI Base
  '@mui/base',
  '@mui/base/Unstable_Popup',

  // MUI Material
  '@mui/material/utils',
  '@mui/x-charts',
  '@mui/material',
  '@mui/icons-material',

  // React
  'react',
  'react/jsx-runtime',
  'react-router-dom',
  'react-dom',
  'react-icons',
  'react-icons/lu',
  'react-icons/si',

  // Monaco
  'monaco-editor',
  'monaco-types',
  'monaco-yaml',
  '@monaco-editor/react',

  // Tanstack
  '@tanstack/react-query',
  '@tanstack/react-table',
  '@tanstack/react-virtual',

  // Omniview
  '@omniviewdev/runtime',
  '@omniviewdev/runtime/api',
  '@omniviewdev/runtime/runtime',
  '@omniviewdev/runtime/models',

  // DND Kit
  '@dnd-kit/core',
  '@dnd-kit/modifiers',
  '@dnd-kit/sortable',
  '@dnd-kit/utilities',

  // Utilities
  'date-fns',
  'yaml',
] as const;
