/* eslint-disable */

import { extendTheme } from '@mui/joy/styles';

export default extendTheme({
  'components': {
    'JoyInput': {
      'defaultProps': {
        'size': 'sm',
        'variant': 'outlined',
      },
      'styleOverrides': {
        'root': ({ ownerState }) => ({
          boxShadow: 'none',
        })
      },
    },
    'JoyListItemContent': {
      'defaultProps': {
        'color': 'primary',
      },
      'styleOverrides': {
        'root': {
          'color': 'var(--joy-palette-neutral-50)',
        }
      }
    },
  },
  'colorSchemes': {
    'light': {
      'palette': {},
    },
    'dark': {
      'palette': {
        'background': {
          'body': 'var(--joy-palette-neutral-900)',
          'surface': 'var(--joy-palette-neutral-800)',
          'level1': '#131315',
        },
        'neutral': {
          '50': '#f4f4f5',
          '100': '#e4e4e7',
          '200': '#d4d4d8',
          '300': '#a1a1aa',
          '400': '#71717a',
          '500': '#52525b',
          '600': '#3f3f46',
          '700': '#27272a',
          '800': '#18181b',
          '900': '#0E0E10',
        },
        'primary': {
          '50': '#f8fafc',
          '100': '#f1f5f9',
          '200': '#e2e8f0',
          '300': '#cbd5e1',
          '400': '#94a3b8',
          '500': '#64748b',
          '600': '#475569',
          '700': '#334155',
          '800': '#1e293b',
          '900': '#0f172a',
        },
        "text": {
          "primary": "var(--joy-palette-primary-50)",
          "secondary": "var(--joy-palette-primary-100)",
          "tertiary": "var(--joy-palette-primary-300)",
          'icon': 'var(--joy-palette-primary-50)',
        }
      },
    },
  },
});
