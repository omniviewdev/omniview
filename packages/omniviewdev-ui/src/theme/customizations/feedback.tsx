/**
 * Feedback Component Customizations
 * Alert, Dialog, Popover, LinearProgress
 */
import { alpha, type Components, type Theme } from '@mui/material/styles';
import { gray as defaultGray } from '../primitives';

type ColorScale = Record<number, string>;

interface FeedbackPalettes {
  gray: ColorScale;
}

export function createFeedbackCustomizations(palettes?: Partial<FeedbackPalettes>): Components<Theme> {
  const gray = palettes?.gray ?? defaultGray;

  return {
  MuiAlert: {
    styleOverrides: {
      root: {},
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
            backgroundColor: gray[900],
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
          backgroundColor: gray[900],
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
}

export const feedbackCustomizations = createFeedbackCustomizations();
