/**
 * Navigation Component Customizations
 * Menu, Link, Drawer, Tabs, etc.
 */
import * as React from 'react';
import { alpha, type Components, type Theme } from '@mui/material/styles';
import type { SvgIconProps } from '@mui/material/SvgIcon';
import { buttonBaseClasses } from '@mui/material/ButtonBase';
import { dividerClasses } from '@mui/material/Divider';
import { menuItemClasses } from '@mui/material/MenuItem';
import { tabClasses } from '@mui/material/Tab';
import UnfoldMoreRoundedIcon from '@mui/icons-material/UnfoldMoreRounded';
import { gray, brand } from '../primitives';

export const navigationCustomizations: Components<Theme> = {
  MuiMenuItem: {
    styleOverrides: {
      root: ({ theme }) => ({
        borderRadius: theme.shape.borderRadius,
        padding: '6px 8px',
        [`&.${menuItemClasses.focusVisible}`]: { backgroundColor: 'transparent' },
        [`&.${menuItemClasses.selected}`]: {
          [`&.${menuItemClasses.focusVisible}`]: {
            backgroundColor: alpha(theme.palette.action.selected, 0.3),
          },
        },
      }),
    },
  },
  MuiMenu: {
    styleOverrides: {
      list: {
        gap: '0px',
        [`&.${dividerClasses.root}`]: { margin: '0 -8px' },
      },
      paper: ({ theme }) => ({
        marginTop: '4px',
        borderRadius: theme.shape.borderRadius,
        border: `1px solid ${theme.palette.divider}`,
        backgroundImage: 'none',
        background: 'hsl(0, 0%, 100%)',
        boxShadow: 'hsla(220, 30%, 5%, 0.07) 0px 4px 16px 0px, hsla(220, 25%, 10%, 0.07) 0px 8px 16px -5px',
        [`& .${buttonBaseClasses.root}`]: {
          '&.Mui-selected': { backgroundColor: alpha(theme.palette.action.selected, 0.3) },
        },
        ...theme.applyStyles('dark', {
          background: gray[900],
          boxShadow: 'hsla(220, 30%, 5%, 0.7) 0px 4px 16px 0px, hsla(220, 25%, 10%, 0.8) 0px 8px 16px -5px',
        }),
      }),
    },
  },
  MuiSelect: {
    defaultProps: {
      IconComponent: React.forwardRef<SVGSVGElement, SvgIconProps>((props, ref) => (
        <UnfoldMoreRoundedIcon fontSize="small" {...props} ref={ref} />
      )),
    },
    styleOverrides: {
      select: { display: 'flex', alignItems: 'center', padding: '10px 14px' },
    },
  },
  MuiLink: {
    defaultProps: { underline: 'none' },
    styleOverrides: {
      root: ({ theme }) => ({
        color: gray[800],
        fontWeight: 500,
        position: 'relative',
        textDecoration: 'none',
        width: 'fit-content',
        '&::before': {
          content: '""',
          position: 'absolute',
          width: '100%',
          height: '1px',
          bottom: 0,
          left: 0,
          backgroundColor: gray[600],
          opacity: 0.3,
          transition: 'width 0.3s ease, opacity 0.3s ease',
        },
        '&:hover::before': { width: 0 },
        '&:focus-visible': {
          outline: `3px solid ${alpha(brand[500], 0.5)}`,
          outlineOffset: '4px',
          borderRadius: '2px',
        },
        ...theme.applyStyles('dark', {
          color: gray[100],
          '&::before': { backgroundColor: gray[400] },
        }),
      }),
    },
  },
  MuiDrawer: {
    styleOverrides: {
      paper: ({ theme }) => ({ backgroundColor: theme.palette.background.default }),
    },
  },
  MuiListItemButton: {
    styleOverrides: {
      root: ({ theme }) => ({
        borderRadius: theme.shape.borderRadius,
        padding: '8px 12px',
        gap: 12,
        border: '1px solid transparent',
        transition: 'all 100ms ease-in',
        '&:hover': { backgroundColor: alpha(gray[500], 0.08) },
        '&.Mui-selected': {
          backgroundColor: alpha(brand[500], 0.08),
          border: `1px solid ${alpha(brand[500], 0.2)}`,
          '&:hover': { backgroundColor: alpha(brand[500], 0.12) },
        },
        ...theme.applyStyles('dark', {
          '&:hover': { backgroundColor: alpha(gray[500], 0.12) },
          '&.Mui-selected': {
            backgroundColor: alpha(brand[400], 0.12),
            border: `1px solid ${alpha(brand[400], 0.25)}`,
            '&:hover': { backgroundColor: alpha(brand[400], 0.16) },
          },
        }),
      }),
    },
  },
  MuiTabs: {
    styleOverrides: {
      root: { minHeight: 'fit-content' },
      indicator: ({ theme }) => ({
        backgroundColor: theme.palette.grey[800],
        ...theme.applyStyles('dark', { backgroundColor: theme.palette.grey[200] }),
      }),
    },
  },
  MuiTab: {
    styleOverrides: {
      root: ({ theme }) => ({
        padding: '6px 8px',
        marginBottom: '8px',
        textTransform: 'none',
        minWidth: 'fit-content',
        minHeight: 'fit-content',
        color: gray[600],
        borderRadius: theme.shape.borderRadius,
        border: '1px solid transparent',
        ':hover': { color: gray[800], backgroundColor: gray[100], borderColor: gray[200] },
        [`&.${tabClasses.selected}`]: { color: gray[900] },
        ...theme.applyStyles('dark', {
          color: gray[400],
          ':hover': { color: gray[100], backgroundColor: gray[800], borderColor: gray[700] },
          [`&.${tabClasses.selected}`]: { color: '#fff' },
        }),
      }),
    },
  },
};
