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
        'root': {
          'boxShadow': 'none',
        },
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
        },
        'neutral': {
          '50': '#fafafa',
          '100': '#f4f4f5',
          '200': '#e4e4e7',
          '300': '#d4d4d8',
          '400': '#a1a1aa',
          '500': '#71717a',
          '600': '#52525b',
          '700': '#3f3f46',
          '800': '#27272a',
          '900': '#18181b',
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
          "secondary": "var(--joy-palette-primary-200)",
          "tertiary": "var(--joy-palette-primary-300)",
          'icon': 'var(--joy-palette-primary-50)',
        }
      },
    },
  },
});
