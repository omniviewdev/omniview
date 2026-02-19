/**
 * Feedback Component Customizations
 * Alert, Dialog, Popover, LinearProgress
 */
import { alpha, type Components, type Theme } from '@mui/material/styles';
import { gray } from '../primitives';

export const feedbackCustomizations: Components<Theme> = {
  MuiAlert: {
    styleOverrides: {
      root: {
        // Sizing and color are handled by the Alert wrapper component.
        // We intentionally don't set padding, borderRadius, or severity-based
        // color variants here to avoid specificity fights with the sx prop.
      },
    },
  },
  MuiDialog: {
    styleOverrides: {
      root: ({ theme }) => ({
        '& .MuiDialog-paper': {
          borderRadius: '10px',
          border: '1px solid',
          borderColor: theme.palette.divider,
          backgroundColor: gray[50],
          ...theme.applyStyles('dark', {
            backgroundColor: 'hsl(220, 25%, 10%)',
            borderColor: alpha(gray[700], 0.6),
          }),
        },
      }),
    },
  },
  MuiPopover: {
    styleOverrides: {
      paper: ({ theme }) => ({
        borderRadius: '10px',
        border: '1px solid',
        borderColor: theme.palette.divider,
        backgroundImage: 'none',
        backgroundColor: gray[50],
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
        ...theme.applyStyles('dark', {
          backgroundColor: 'hsl(220, 25%, 10%)',
          borderColor: alpha(gray[700], 0.6),
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
        }),
      }),
    },
  },
  MuiLinearProgress: {
    styleOverrides: {
      root: ({ theme }) => ({
        height: 8, borderRadius: 8, backgroundColor: gray[200],
        ...theme.applyStyles('dark', { backgroundColor: gray[800] }),
      }),
    },
  },
};
