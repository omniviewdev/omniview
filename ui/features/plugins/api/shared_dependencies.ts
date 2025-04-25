/**
 * NOTE: IMPORTANT!! ensure that before adding more here, that the externals are updated in the source plugin, and
 * vice versa. This is to ensure that the plugin is not bundled with the dependencies, and instead
 * will use the shared dependencies that are already loaded in the main app to prevent bloating the bundle size.
 */
export const shared = {
  /**
   * Material UI
   */
  '@emotion/react': () => import('@emotion/react'),
  '@mui/joy': () => import('@mui/joy'),
  '@mui/base': () => import('@mui/base'),
  '@mui/x-charts': () => import('@mui/x-charts'),
  '@mui/material': () => import('@mui/material'),
  '@mui/material-icons': () => import('@mui/icons-material'),

  /** React */
  'react': () => import('react'),
  'react/jsx-runtime': () => import('react/jsx-runtime'),
  'react-router-dom': () => import('react-router-dom'),
  'react-dom': () => import('react-dom'),
  'react-icons': () => import('react-icons'),

  /** Tanstack */
  '@tanstack/react-query': () => import('@tanstack/react-query'),
  '@tanstack/react-table': () => import('@tanstack/react-table'),
  '@tanstack/react-virtual': () => import('@tanstack/react-virtual'),

  /** Omniview */
  '@omniviewdev/runtime': () => import('@omniviewdev/runtime'),
  '@omniviewdev/runtime/api': () => import('@omniviewdev/runtime/api'),
  '@omniviewdev/runtime/runtime': () => import('@omniviewdev/runtime/runtime'),
  '@omniviewdev/runtime/models': () => import('@omniviewdev/runtime/models'),
};
