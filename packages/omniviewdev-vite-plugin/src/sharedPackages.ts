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

  // MUI Material
  '@mui/material',
  '@mui/material/utils',
  '@mui/material/styles',
  '@mui/material/Box',
  '@mui/material/Grid',
  '@mui/material/GlobalStyles',
  '@mui/material/CssBaseline',
  '@mui/material/CircularProgress',
  '@mui/material/LinearProgress',
  '@mui/material/Divider',
  '@mui/icons-material',
  '@mui/x-charts',

  // @omniviewdev/ui design system
  '@omniviewdev/ui',
  '@omniviewdev/ui/buttons',
  '@omniviewdev/ui/inputs',
  '@omniviewdev/ui/feedback',
  '@omniviewdev/ui/typography',
  '@omniviewdev/ui/overlays',
  '@omniviewdev/ui/navigation',
  '@omniviewdev/ui/table',
  '@omniviewdev/ui/layout',
  '@omniviewdev/ui/domain',
  '@omniviewdev/ui/charts',
  '@omniviewdev/ui/editors',
  '@omniviewdev/ui/types',
  '@omniviewdev/ui/theme',
  '@omniviewdev/ui/menus',
  '@omniviewdev/ui/sidebars',
  '@omniviewdev/ui/cells',

  // React
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
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
