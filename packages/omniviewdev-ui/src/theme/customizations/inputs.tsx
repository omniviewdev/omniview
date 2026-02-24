/**
 * Input Component Customizations
 * Button, TextField, Checkbox, Switch, etc.
 */
import * as React from 'react';
import { alpha, darken, lighten, type Components, type Theme } from '@mui/material/styles';
import { outlinedInputClasses } from '@mui/material/OutlinedInput';
import { toggleButtonGroupClasses } from '@mui/material/ToggleButtonGroup';
import { toggleButtonClasses } from '@mui/material/ToggleButton';
import CheckBoxOutlineBlankRoundedIcon from '@mui/icons-material/CheckBoxOutlineBlankRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded';
import { gray, brand } from '../primitives';

export const inputsCustomizations: Components<Theme> = {
  MuiButtonBase: {
    defaultProps: {
      disableTouchRipple: true,
      disableRipple: true,
    },
    styleOverrides: {
      root: ({ theme }) => ({
        boxSizing: 'border-box',
        transition: 'color 80ms cubic-bezier(0.33,1,0.68,1), background-color 80ms cubic-bezier(0.33,1,0.68,1), border-color 80ms cubic-bezier(0.33,1,0.68,1), box-shadow 80ms cubic-bezier(0.33,1,0.68,1)',
        '&:focus-visible': {
          outline: `3px solid ${alpha(theme.palette.primary.main, 0.5)}`,
          outlineOffset: '2px',
        },
      }),
    },
  },
  MuiButton: {
    defaultProps: {
      disableElevation: true,
    },
    styleOverrides: {
      root: ({ theme }) => {
        // Build per-color variants for outlined, text, soft, and link
        const paletteEntries: Array<[string, { main: string; light: string; dark: string; contrastText?: string }]> = [
          ['primary', theme.palette.primary],
          ['secondary', theme.palette.secondary],
          ['success', theme.palette.success],
          ['warning', theme.palette.warning],
          ['error', theme.palette.error],
          ['info', theme.palette.info],
        ];

        // --- Contained: flat solid per-color ---
        // Hover shifts background-color slightly via darken/lighten so the
        // CSS transition on background-color produces a smooth fade (à la
        // GitHub Primer: 80ms cubic-bezier).  No backgroundImage overlay
        // (which is NOT animatable and causes abrupt snaps).
        const containedVariants = paletteEntries.map(([color, pal]) => ({
          props: { color, variant: 'contained' },
          style: {
            backgroundColor: pal.main,
            color: pal.contrastText || '#fff',
            '&:hover': {
              backgroundColor: darken(pal.main, 0.12),
            },
            '&:active': {
              backgroundColor: darken(pal.main, 0.2),
            },
            ...theme.applyStyles('dark', {
              backgroundColor: pal.main,
              color: pal.contrastText || '#fff',
              '&:hover': {
                backgroundColor: lighten(pal.main, 0.12),
              },
              '&:active': {
                backgroundColor: lighten(pal.main, 0.04),
              },
            }),
          },
        }));

        // --- Outlined: colored border + text per-color ---
        const outlinedVariants = paletteEntries.map(([color, pal]) => ({
          props: { color, variant: 'outlined' },
          style: {
            color: pal.main,
            borderColor: alpha(pal.main, 0.5),
            backgroundColor: 'transparent',
            '&:hover': { backgroundColor: alpha(pal.main, 0.06), borderColor: pal.main },
            '&:active': { backgroundColor: alpha(pal.main, 0.12) },
            ...theme.applyStyles('dark', {
              color: pal.light,
              borderColor: alpha(pal.light, 0.4),
              '&:hover': { backgroundColor: alpha(pal.main, 0.12), borderColor: pal.light },
              '&:active': { backgroundColor: alpha(pal.main, 0.2) },
            }),
          },
        }));

        // --- Text (ghost): colored text per-color ---
        const textVariants = paletteEntries.map(([color, pal]) => ({
          props: { color, variant: 'text' },
          style: {
            color: pal.main,
            '&:hover': { backgroundColor: alpha(pal.main, 0.06) },
            '&:active': { backgroundColor: alpha(pal.main, 0.12) },
            ...theme.applyStyles('dark', {
              color: pal.light,
              '&:hover': { backgroundColor: alpha(pal.main, 0.12) },
              '&:active': { backgroundColor: alpha(pal.main, 0.2) },
            }),
          },
        }));

        // --- Soft (custom): tinted background per-color ---
        const softVariants = paletteEntries.map(([color, pal]) => ({
          props: { color, variant: 'soft' as const },
          style: {
            color: pal.main,
            backgroundColor: alpha(pal.main, 0.1),
            '&:hover': { backgroundColor: alpha(pal.main, 0.18) },
            '&:active': { backgroundColor: alpha(pal.main, 0.26) },
            ...theme.applyStyles('dark', {
              color: pal.light,
              backgroundColor: alpha(pal.main, 0.15),
              '&:hover': { backgroundColor: alpha(pal.main, 0.25) },
              '&:active': { backgroundColor: alpha(pal.main, 0.32) },
            }),
          },
        }));

        // --- Link (custom): colored text + underline per-color ---
        const linkVariants = paletteEntries.map(([color, pal]) => ({
          props: { color, variant: 'link' as const },
          style: {
            color: pal.main,
            ...theme.applyStyles('dark', { color: pal.light }),
          },
        }));

        return {
          boxShadow: 'none',
          borderRadius: theme.shape.borderRadius,
          textTransform: 'none',
          whiteSpace: 'nowrap',
          // GitHub Primer-style fast, smooth transition on bg-color
          transition: 'color 80ms cubic-bezier(0.33,1,0.68,1), background-color 80ms cubic-bezier(0.33,1,0.68,1), border-color 80ms cubic-bezier(0.33,1,0.68,1), box-shadow 80ms cubic-bezier(0.33,1,0.68,1)',
          variants: [
            // === Sizes ===
            { props: { size: 'small' }, style: { minHeight: '2rem', padding: '6px 12px' } },
            { props: { size: 'medium' }, style: { minHeight: '2.25rem', padding: '8px 16px' } },
            { props: { size: 'large' }, style: { minHeight: '2.75rem', padding: '10px 20px' } },
            { props: { size: 'xs' as const }, style: { minHeight: '1.5rem', padding: '2px 8px', fontSize: '0.6875rem' } },
            { props: { size: 'xl' as const }, style: { minHeight: '3.25rem', padding: '12px 24px', fontSize: '1rem' } },

            // === Contained: flat solid ===
            // Default/neutral: gray solid
            {
              props: { variant: 'contained' },
              style: {
                boxShadow: 'none',
                '&:hover': { boxShadow: 'none' },
              },
            },
            ...containedVariants,

            // === Outlined: default/neutral gets gray ===
            {
              props: { variant: 'outlined' },
              style: {
                color: gray[700],
                border: '1px solid',
                borderColor: gray[200],
                backgroundColor: alpha(gray[50], 0.3),
                '&:hover': { backgroundColor: gray[100], borderColor: gray[300] },
                '&:active': { backgroundColor: gray[200] },
                ...theme.applyStyles('dark', {
                  color: gray[200],
                  backgroundColor: alpha(gray[800], 0.3),
                  borderColor: gray[600],
                  '&:hover': { backgroundColor: alpha(gray[700], 0.5), borderColor: gray[500] },
                  '&:active': { backgroundColor: gray[700] },
                }),
              },
            },
            ...outlinedVariants,

            // === Text (ghost): default/neutral gets gray ===
            {
              props: { variant: 'text' },
              style: {
                color: gray[600],
                '&:hover': { backgroundColor: alpha(gray[500], 0.08) },
                '&:active': { backgroundColor: alpha(gray[500], 0.16) },
                ...theme.applyStyles('dark', {
                  color: gray[300],
                  '&:hover': { backgroundColor: alpha(gray[500], 0.12) },
                  '&:active': { backgroundColor: alpha(gray[500], 0.2) },
                }),
              },
            },
            ...textVariants,

            // === Soft (custom): default/neutral gets gray ===
            {
              props: { variant: 'soft' as const },
              style: {
                color: gray[700],
                backgroundColor: alpha(gray[500], 0.08),
                '&:hover': { backgroundColor: alpha(gray[500], 0.16) },
                '&:active': { backgroundColor: alpha(gray[500], 0.24) },
                ...theme.applyStyles('dark', {
                  color: gray[200],
                  backgroundColor: alpha(gray[500], 0.12),
                  '&:hover': { backgroundColor: alpha(gray[500], 0.2) },
                  '&:active': { backgroundColor: alpha(gray[500], 0.28) },
                }),
              },
            },
            ...softVariants,

            // === Link (custom): base ===
            {
              props: { variant: 'link' as const },
              style: {
                color: gray[600],
                backgroundColor: 'transparent',
                padding: '0 4px',
                minWidth: 'auto',
                textDecoration: 'none',
                '&:hover': {
                  backgroundColor: 'transparent',
                  textDecoration: 'underline',
                },
                ...theme.applyStyles('dark', {
                  color: gray[300],
                }),
              },
            },
            ...linkVariants,
          ],
        };
      },
    },
  },
  MuiIconButton: {
    styleOverrides: {
      root: ({ theme }) => ({
        boxSizing: 'border-box',
        borderRadius: theme.shape.borderRadius,
        color: gray[600],
        '&:hover': { backgroundColor: alpha(gray[500], 0.1) },
        ...theme.applyStyles('dark', {
          color: gray[300],
          '&:hover': { backgroundColor: alpha(gray[500], 0.2) },
        }),
        variants: [
          { props: { size: 'small' }, style: { width: '2rem', height: '2rem', padding: '0.25rem' } },
          { props: { size: 'medium' }, style: { width: '2.5rem', height: '2.5rem' } },
          {
            props: { color: 'primary' },
            style: {
              color: brand[600],
              '&:hover': { backgroundColor: alpha(brand[500], 0.1) },
              ...theme.applyStyles('dark', {
                color: brand[300],
                '&:hover': { backgroundColor: alpha(brand[500], 0.2) },
              }),
            },
          },
        ],
      }),
    },
  },
  MuiToggleButtonGroup: {
    styleOverrides: {
      root: ({ theme }) => ({
        borderRadius: theme.shape.borderRadius,
        backgroundColor: gray[100],
        border: `1px solid ${gray[200]}`,
        boxShadow: 'none',
        [`& .${toggleButtonGroupClasses.grouped}`]: {
          border: 'none',
          '&:not(:first-of-type)': { marginLeft: 0, borderLeft: '1px solid', borderLeftColor: gray[300] },
        },
        ...theme.applyStyles('dark', {
          backgroundColor: alpha(gray[800], 0.5),
          border: `1px solid ${gray[700]}`,
          [`& .${toggleButtonGroupClasses.grouped}`]: {
            '&:not(:first-of-type)': { borderLeftColor: gray[700] },
          },
        }),
      }),
    },
  },
  MuiToggleButton: {
    styleOverrides: {
      root: ({ theme }) => ({
        padding: '8px 16px',
        fontWeight: 500,
        color: gray[600],
        textTransform: 'none',
        border: 'none',
        borderRadius: theme.shape.borderRadius,
        '&:hover': { backgroundColor: alpha(gray[500], 0.1) },
        [`&.${toggleButtonClasses.selected}`]: {
          color: brand[600],
          backgroundColor: alpha(brand[500], 0.1),
          '&:hover': { backgroundColor: alpha(brand[500], 0.15) },
        },
        ...theme.applyStyles('dark', {
          color: gray[400],
          '&:hover': { backgroundColor: alpha(gray[500], 0.15) },
          [`&.${toggleButtonClasses.selected}`]: {
            color: brand[300],
            backgroundColor: alpha(brand[500], 0.2),
            '&:hover': { backgroundColor: alpha(brand[500], 0.25) },
          },
        }),
      }),
    },
  },
  MuiCheckbox: {
    defaultProps: {
      disableRipple: true,
      icon: React.createElement(CheckBoxOutlineBlankRoundedIcon, { sx: { color: 'hsla(210, 0%, 0%, 0.0)' } }),
      checkedIcon: React.createElement(CheckRoundedIcon, { sx: { height: 14, width: 14 } }),
      indeterminateIcon: React.createElement(RemoveRoundedIcon, { sx: { height: 14, width: 14 } }),
    },
    styleOverrides: {
      root: ({ theme }) => ({
        margin: 10,
        height: 16,
        width: 16,
        borderRadius: 5,
        border: '1px solid',
        borderColor: alpha(gray[300], 0.8),
        boxShadow: '0 0 0 1.5px hsla(210, 0%, 0%, 0.04) inset',
        backgroundColor: alpha(gray[100], 0.4),
        transition: 'border-color, background-color, 120ms ease-in',
        '&:hover': { borderColor: brand[300] },
        '&.Mui-checked': {
          color: 'white',
          backgroundColor: brand[500],
          borderColor: brand[500],
          boxShadow: 'none',
          '&:hover': { backgroundColor: brand[600] },
        },
        ...theme.applyStyles('dark', {
          borderColor: alpha(gray[700], 0.8),
          boxShadow: '0 0 0 1.5px hsl(210, 0%, 0%) inset',
          backgroundColor: alpha(gray[900], 0.8),
          '&:hover': { borderColor: brand[300] },
        }),
      }),
    },
  },
  MuiSelect: {
    styleOverrides: {
      select: {
        // Prevent chips from wrapping to multiple lines.
        display: 'flex',
        alignItems: 'center',
        overflow: 'hidden',
        '& > .MuiBox-root': {
          flexWrap: 'nowrap',
          overflow: 'hidden',
        },
      },
    },
  },
  MuiAutocomplete: {
    styleOverrides: {
      inputRoot: {
        // Prevent the tag container from wrapping and keep fixed height.
        flexWrap: 'nowrap !important' as any,
        overflow: 'hidden',
      },
      tag: {
        // Constrain chip tags to match the input line-height.
        maxHeight: 20,
      },
    },
  },
  MuiFormControl: {
    styleOverrides: {
      root: () => ({
        // Input height token — read by OutlinedInput (height) and
        // InputLabel (vertical centering).  Our wrapper components
        // override this for the full xs/sm/md/lg/xl range.
        '--ov-input-height': '2.75rem',
        variants: [
          { props: { size: 'small' }, style: { '--ov-input-height': '2.25rem' } },
        ],
      }),
    },
  },
  MuiInputLabel: {
    styleOverrides: {
      root: {
        // Shrunk (floating) label — centered on the top border
        '&.MuiInputLabel-shrink': {
          transform: 'translate(14px, -6px) scale(0.75)',
        },
        // Non-shrunk label — auto-center vertically using calc().
        // 1.4375em = the label's line-height (unitless 1.4375 × font-size),
        // expressed in em so it auto-adapts to both small and medium labels.
        '&.MuiInputLabel-outlined:not(.MuiInputLabel-shrink)': {
          transform: 'translate(14px, calc((var(--ov-input-height) - 1.4375em) / 2)) scale(1)',
        },
      },
    },
  },
  MuiInputBase: {
    defaultProps: {
      autoCapitalize: 'off',
      autoCorrect: 'off',
      spellCheck: false,
    },
    styleOverrides: {
      root: ({ theme }) => ({
        border: 'none',
        ...theme.applyStyles('dark', { '&.Mui-disabled': { color: gray[600] } }),
      }),
      input: ({ theme }) => ({
        // Disable WebKit auto-capitalize / auto-correct text transformations
        textTransform: 'none',
        WebkitTextSecurity: 'none',
        '&::placeholder': { opacity: 0.7, color: gray[500] },
        ...theme.applyStyles('dark', { '&::placeholder': { color: gray[500] } }),
      }),
    },
  },
  MuiOutlinedInput: {
    styleOverrides: {
      input: { padding: '10px 14px' },
      inputMultiline: { padding: 0 },
      root: ({ theme }) => ({
        borderRadius: theme.shape.borderRadius,
        backgroundColor: gray[50],
        transition: 'background-color 120ms ease-in',
        // Fixed height from the --ov-input-height CSS variable
        // (set on the parent FormControl).  Multiline inputs use
        // minHeight so they can grow.
        '&:not(.MuiInputBase-multiline)': {
          boxSizing: 'border-box',
          height: 'var(--ov-input-height)',
        },
        '&.MuiInputBase-multiline': {
          padding: '10px 14px',
          minHeight: 'var(--ov-input-height)',
        },
        '&:hover': {
          backgroundColor: gray[100],
          [`& .${outlinedInputClasses.notchedOutline}`]: { borderColor: gray[400] },
        },
        [`&.${outlinedInputClasses.focused}`]: {
          [`& .${outlinedInputClasses.notchedOutline}`]: { borderColor: brand[500], borderWidth: 2 },
        },
        [`&.${outlinedInputClasses.disabled}`]: {
          backgroundColor: gray[100],
          [`& .${outlinedInputClasses.notchedOutline}`]: { borderColor: gray[200] },
        },
        ...theme.applyStyles('dark', {
          backgroundColor: alpha(gray[800], 0.8),
          '&:hover': {
            backgroundColor: alpha(gray[800], 0.9),
            [`& .${outlinedInputClasses.notchedOutline}`]: { borderColor: gray[500] },
          },
          [`&.${outlinedInputClasses.focused}`]: {
            backgroundColor: alpha(gray[800], 0.9),
            [`& .${outlinedInputClasses.notchedOutline}`]: { borderColor: brand[400] },
          },
          [`&.${outlinedInputClasses.disabled}`]: {
            backgroundColor: alpha(gray[900], 0.6),
            [`& .${outlinedInputClasses.notchedOutline}`]: { borderColor: gray[800] },
          },
        }),
      }),
      notchedOutline: ({ theme }) => ({
        borderColor: gray[300],
        transition: 'border-color 120ms ease-in',
        ...theme.applyStyles('dark', { borderColor: gray[700] }),
      }),
    },
  },
  MuiInputAdornment: {
    styleOverrides: {
      root: ({ theme }) => ({
        color: theme.palette.grey[500],
        ...theme.applyStyles('dark', { color: theme.palette.grey[400] }),
      }),
    },
  },
  MuiSwitch: {
    styleOverrides: {
      // Track: 44×24 pill (shadcn/Radix proportions).
      root: { width: 44, height: 24, padding: 0 },
      switchBase: ({ theme }) => ({
        padding: 0,
        margin: 2,
        // Radix-style snappy thumb slide.
        transitionDuration: '140ms',
        transitionTimingFunction: 'cubic-bezier(0.45, 0.05, 0.55, 0.95)',
        transitionProperty: 'transform',
        '&.Mui-checked': {
          // translateX = trackWidth - thumbDiameter - 2*margin = 44 - 20 - 4 = 20
          transform: 'translateX(20px)',
          color: '#fff',
          '& + .MuiSwitch-track': {
            backgroundColor: brand[500],
            opacity: 1,
            border: 0,
          },
        },
        '&.Mui-focusVisible + .MuiSwitch-track': {
          outline: `2px solid ${alpha(brand[500], 0.5)}`,
          outlineOffset: 2,
        },
        '&.Mui-disabled + .MuiSwitch-track': { opacity: 0.4 },
        '&.Mui-disabled .MuiSwitch-thumb': { opacity: 0.7 },
        ...theme.applyStyles('dark', {
          '&.Mui-checked': {
            '& + .MuiSwitch-track': { backgroundColor: brand[400] },
          },
        }),
      }),
      // Thumb: 20px circle with layered shadow for depth (key polish factor).
      thumb: {
        boxSizing: 'border-box',
        width: 20,
        height: 20,
        boxShadow:
          '0 0 0 1px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.10), 0 2px 6px rgba(0,0,0,0.08)',
      },
      // Track: full pill with fast color transition.
      track: ({ theme }) => ({
        borderRadius: 9999,
        backgroundColor: gray[300],
        opacity: 1,
        transition: 'background-color 120ms linear',
        ...theme.applyStyles('dark', { backgroundColor: gray[600] }),
      }),
    },
  },
};
