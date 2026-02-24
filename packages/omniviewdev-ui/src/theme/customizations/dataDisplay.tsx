/**
 * Data Display Component Customizations
 * Card, Chip, Table, Avatar, Accordion, etc.
 */
import { alpha, type Components, type Theme } from '@mui/material/styles';
import { svgIconClasses } from '@mui/material/SvgIcon';
import { typographyClasses } from '@mui/material/Typography';
import { buttonBaseClasses } from '@mui/material/ButtonBase';
import { chipClasses } from '@mui/material/Chip';
import { iconButtonClasses } from '@mui/material/IconButton';
import { gray, brand, green, orange, red, purple } from '../primitives';

export const dataDisplayCustomizations: Components<Theme> = {
  MuiList: {
    styleOverrides: {
      root: { padding: '8px', display: 'flex', flexDirection: 'column', gap: 0 },
    },
  },
  MuiListItem: {
    styleOverrides: {
      root: ({ theme }) => ({
        [`& > .${svgIconClasses.root}`]: { width: '1rem', height: '1rem', color: gray[600] },
        [`& .${typographyClasses.root}`]: { fontWeight: 500 },
        [`& .${buttonBaseClasses.root}`]: {
          display: 'flex',
          gap: 8,
          padding: '2px 8px',
          borderRadius: theme.shape.borderRadius,
          opacity: 0.7,
          '&.Mui-selected': {
            opacity: 1,
            backgroundColor: alpha(gray[200], 0.6),
            [`& .${svgIconClasses.root}`]: { color: gray[800] },
            '&:hover': { backgroundColor: alpha(gray[200], 0.8) },
          },
        },
        ...theme.applyStyles('dark', {
          [`& > .${svgIconClasses.root}`]: { color: gray[400] },
          [`& .${buttonBaseClasses.root}`]: {
            '&.Mui-selected': {
              backgroundColor: alpha(gray[600], 0.3),
              [`& .${svgIconClasses.root}`]: { color: gray[100] },
              '&:hover': { backgroundColor: alpha(gray[600], 0.5) },
            },
          },
        }),
      }),
    },
  },
  MuiListItemText: {
    styleOverrides: {
      primary: ({ theme }) => ({
        fontSize: theme.typography.body2.fontSize,
        fontWeight: 500,
        lineHeight: theme.typography.body2.lineHeight,
      }),
      secondary: ({ theme }) => ({
        fontSize: theme.typography.caption.fontSize,
        lineHeight: theme.typography.caption.lineHeight,
      }),
    },
  },
  MuiListSubheader: {
    styleOverrides: {
      root: ({ theme }) => ({
        backgroundColor: 'transparent',
        padding: '4px 8px',
        fontSize: theme.typography.caption.fontSize,
        fontWeight: 500,
        lineHeight: theme.typography.caption.lineHeight,
      }),
    },
  },
  MuiListItemIcon: {
    styleOverrides: { root: { minWidth: 0 } },
  },
  MuiCard: {
    defaultProps: { elevation: 0 },
    styleOverrides: {
      root: ({ theme }) => ({
        display: 'flex',
        flexDirection: 'column' as const,
        padding: 16,
        gap: 16,
        overflow: 'visible',
        transition: 'all 150ms ease-in-out',
        backgroundColor: gray[50],
        borderRadius: theme.shape.borderRadius,
        border: `1px solid ${theme.palette.divider}`,
        boxShadow: 'none',
        '&:hover': {
          borderColor: gray[300],
          boxShadow: '0 2px 8px 0 rgba(0, 0, 0, 0.08)',
        },
        ...theme.applyStyles('dark', {
          backgroundColor: gray[800],
          '&:hover': {
            borderColor: gray[600],
            boxShadow: '0 2px 8px 0 rgba(0, 0, 0, 0.3)',
          },
        }),
        variants: [
          {
            props: { variant: 'outlined' },
            style: {
              border: `1px solid ${theme.palette.divider}`,
              boxShadow: 'none',
              background: 'hsl(0, 0%, 100%)',
              '&:hover': {
                borderColor: gray[300],
                boxShadow: '0 2px 8px 0 rgba(0, 0, 0, 0.08)',
              },
              ...theme.applyStyles('dark', {
                background: alpha(gray[900], 0.4),
                '&:hover': {
                  borderColor: gray[600],
                  boxShadow: '0 2px 8px 0 rgba(0, 0, 0, 0.3)',
                },
              }),
            },
          },
        ],
      }),
    },
  },
  MuiCardContent: {
    styleOverrides: { root: { padding: 0, '&:last-child': { paddingBottom: 0 } } },
  },
  MuiCardHeader: {
    styleOverrides: { root: { padding: 0 } },
  },
  MuiCardActions: {
    styleOverrides: { root: { padding: 0 } },
  },
  MuiPaper: {
    defaultProps: { elevation: 0 },
    styleOverrides: {
      root: ({ theme }) => ({
        backgroundImage: 'none',
        ...theme.applyStyles('dark', { backgroundColor: gray[800] }),
      }),
    },
  },
  MuiChip: {
    defaultProps: { size: 'small' },
    styleOverrides: {
      root: ({ theme }) => ({
        border: '1px solid',
        borderRadius: 6,
        [`& .${chipClasses.label}`]: { fontWeight: 600 },
        variants: [
          {
            props: { color: 'default' },
            style: {
              borderColor: gray[200], backgroundColor: gray[100],
              [`& .${chipClasses.label}`]: { color: gray[500] },
              [`& .${chipClasses.icon}`]: { color: gray[500] },
              [`& .${chipClasses.deleteIcon}`]: { color: gray[400], '&:hover': { color: gray[600] } },
              ...theme.applyStyles('dark', {
                borderColor: gray[600], backgroundColor: alpha(gray[600], 0.3),
                [`& .${chipClasses.label}`]: { color: gray[200] },
                [`& .${chipClasses.icon}`]: { color: gray[200] },
                [`& .${chipClasses.deleteIcon}`]: { color: gray[400], '&:hover': { color: gray[200] } },
              }),
            },
          },
          {
            props: { color: 'success' },
            style: {
              borderColor: green[200], backgroundColor: green[50],
              [`& .${chipClasses.label}`]: { color: green[500] },
              [`& .${chipClasses.icon}`]: { color: green[500] },
              ...theme.applyStyles('dark', {
                borderColor: green[800], backgroundColor: green[900],
                [`& .${chipClasses.label}`]: { color: green[200] },
                [`& .${chipClasses.icon}`]: { color: green[200] },
              }),
            },
          },
          {
            props: { color: 'error' },
            style: {
              borderColor: red[100], backgroundColor: red[50],
              [`& .${chipClasses.label}`]: { color: red[500] },
              [`& .${chipClasses.icon}`]: { color: red[500] },
              ...theme.applyStyles('dark', {
                borderColor: red[800], backgroundColor: red[900],
                [`& .${chipClasses.label}`]: { color: red[100] },
                [`& .${chipClasses.icon}`]: { color: red[100] },
              }),
            },
          },
          {
            props: { color: 'warning' },
            style: {
              borderColor: orange[200], backgroundColor: orange[50],
              [`& .${chipClasses.label}`]: { color: orange[500] },
              [`& .${chipClasses.icon}`]: { color: orange[500] },
              ...theme.applyStyles('dark', {
                borderColor: orange[800], backgroundColor: orange[900],
                [`& .${chipClasses.label}`]: { color: orange[200] },
                [`& .${chipClasses.icon}`]: { color: orange[200] },
              }),
            },
          },
          {
            props: { color: 'primary' },
            style: {
              borderColor: brand[200], backgroundColor: brand[50],
              [`& .${chipClasses.label}`]: { color: brand[500] },
              [`& .${chipClasses.icon}`]: { color: brand[500] },
              ...theme.applyStyles('dark', {
                borderColor: brand[800], backgroundColor: brand[900],
                [`& .${chipClasses.label}`]: { color: brand[100] },
                [`& .${chipClasses.icon}`]: { color: brand[100] },
              }),
            },
          },
          {
            props: { color: 'secondary' },
            style: {
              borderColor: purple[200], backgroundColor: purple[50],
              [`& .${chipClasses.label}`]: { color: purple[500] },
              [`& .${chipClasses.icon}`]: { color: purple[500] },
              ...theme.applyStyles('dark', {
                borderColor: purple[700], backgroundColor: purple[900],
                [`& .${chipClasses.label}`]: { color: purple[100] },
                [`& .${chipClasses.icon}`]: { color: purple[100] },
              }),
            },
          },
          {
            props: { variant: 'outlined', color: 'default' },
            style: {
              backgroundColor: 'transparent', borderColor: gray[300],
              [`& .${chipClasses.label}`]: { color: gray[500] },
              ...theme.applyStyles('dark', {
                backgroundColor: 'transparent', borderColor: gray[500],
                [`& .${chipClasses.label}`]: { color: gray[200] },
              }),
            },
          },
          {
            props: { size: 'small' },
            style: {
              height: 20, borderRadius: 6,
              [`& .${chipClasses.label}`]: { fontSize: theme.typography.caption.fontSize, padding: '0 6px' },
            },
          },
          {
            props: { size: 'medium' },
            style: {
              height: 28, borderRadius: 8,
              [`& .${chipClasses.label}`]: { fontSize: theme.typography.caption.fontSize },
            },
          },
        ],
      }),
    },
  },
  MuiTablePagination: {
    styleOverrides: {
      actions: {
        display: 'flex', gap: 8, marginRight: 6,
        [`& .${iconButtonClasses.root}`]: { minWidth: 0, width: 36, height: 36 },
      },
    },
  },
  MuiAvatar: {
    styleOverrides: {
      root: {
        color: '#ffffff',
        fontWeight: 600,
      },
    },
  },
  MuiDivider: {
    styleOverrides: {
      root: ({ theme }) => ({
        borderColor: gray[200],
        ...theme.applyStyles('dark', { borderColor: gray[700] }),
      }),
    },
  },
  MuiTable: {
    styleOverrides: { root: { borderCollapse: 'separate', borderSpacing: 0 } },
  },
  MuiTableHead: {
    styleOverrides: {
      root: ({ theme }) => ({
        backgroundColor: gray[50],
        ...theme.applyStyles('dark', { backgroundColor: gray[900] }),
      }),
    },
  },
  MuiTableCell: {
    styleOverrides: {
      root: ({ theme }) => ({
        borderColor: gray[200], padding: '0.75rem 1rem',
        ...theme.applyStyles('dark', { borderColor: gray[700] }),
      }),
      head: ({ theme }) => ({
        fontWeight: 600, color: gray[700],
        ...theme.applyStyles('dark', { color: gray[300] }),
      }),
    },
  },
  MuiTableRow: {
    styleOverrides: {
      root: ({ theme }) => ({
        '&:hover': { backgroundColor: alpha(gray[100], 0.5) },
        '&.Mui-selected': {
          backgroundColor: alpha(brand[500], 0.08),
          '&:hover': { backgroundColor: alpha(brand[500], 0.12) },
        },
        ...theme.applyStyles('dark', {
          '&:hover': { backgroundColor: alpha(gray[700], 0.3) },
          '&.Mui-selected': {
            backgroundColor: alpha(brand[400], 0.15),
            '&:hover': { backgroundColor: alpha(brand[400], 0.2) },
          },
        }),
      }),
    },
  },
  MuiAccordion: {
    styleOverrides: {
      root: ({ theme }) => ({
        border: `1px solid ${gray[200]}`,
        borderRadius: theme.shape.borderRadius,
        '&:before': { display: 'none' },
        '&.Mui-expanded': { margin: 0 },
        ...theme.applyStyles('dark', {
          border: `1px solid ${gray[700]}`,
          backgroundColor: gray[800],
        }),
      }),
    },
  },
  MuiAccordionSummary: {
    styleOverrides: {
      root: ({ theme }) => ({
        borderRadius: theme.shape.borderRadius,
        fontWeight: 600,
        '&.Mui-expanded': { minHeight: 48 },
      }),
      content: { '&.Mui-expanded': { margin: '12px 0' } },
    },
  },
  MuiAccordionDetails: {
    styleOverrides: {
      root: ({ theme }) => ({
        borderTop: `1px solid ${gray[200]}`,
        ...theme.applyStyles('dark', { borderTop: `1px solid ${gray[700]}` }),
      }),
    },
  },
  MuiTypography: {
    styleOverrides: {
      root: { WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale' },
    },
  },
};
