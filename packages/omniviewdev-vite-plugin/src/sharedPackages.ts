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
  // React
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react/compiler-runtime',
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

  // @omniviewdev npm packages (base-ui, ai-ui, editors)
  '@omniviewdev/base-ui',
  '@omniviewdev/base-ui/styles.css',
  '@omniviewdev/ai-ui',
  '@omniviewdev/ai-ui/styles.css',
  '@omniviewdev/editors',
  '@omniviewdev/editors/styles.css',

  // DND Kit
  '@dnd-kit/core',
  '@dnd-kit/modifiers',
  '@dnd-kit/sortable',
  '@dnd-kit/utilities',

  // Utilities
  'date-fns',
  'yaml',
] as const;
