import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

export interface AppShellProps {
  header?: ReactNode;
  sidebar?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  sidebarWidth?: number | string;
  sidebarCollapsed?: boolean;
  headerHeight?: number | string;
  footerHeight?: number | string;
  sx?: SxProps<Theme>;
}

export default function AppShell({
  header,
  sidebar,
  footer,
  children,
  sidebarWidth = 240,
  sidebarCollapsed = false,
  headerHeight = 48,
  footerHeight = 32,
  sx,
}: AppShellProps) {
  const sidebarW = sidebarCollapsed ? 0 : sidebarWidth;
  const headerH = header ? headerHeight : 0;
  const footerH = footer ? footerHeight : 0;

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateAreas: `
          "header header"
          "sidebar main"
          "footer footer"
        `,
        gridTemplateColumns: sidebar ? `${typeof sidebarW === 'number' ? `${sidebarW}px` : sidebarW} 1fr` : '1fr',
        gridTemplateRows: `${typeof headerH === 'number' ? `${headerH}px` : headerH} 1fr ${typeof footerH === 'number' ? `${footerH}px` : footerH}`,
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        '--ov-shell-sidebar-width': typeof sidebarW === 'number' ? `${sidebarW}px` : sidebarW,
        '--ov-shell-header-height': typeof headerH === 'number' ? `${headerH}px` : headerH,
        '--ov-shell-footer-height': typeof footerH === 'number' ? `${footerH}px` : footerH,
        ...sx as Record<string, unknown>,
      }}
    >
      {header && (
        <Box sx={{ gridArea: 'header', overflow: 'hidden' }}>{header}</Box>
      )}
      {sidebar && (
        <Box
          sx={{
            gridArea: 'sidebar',
            overflow: 'auto',
            transition: 'width 0.2s ease',
          }}
        >
          {sidebar}
        </Box>
      )}
      <Box sx={{ gridArea: 'main', overflow: 'auto' }}>{children}</Box>
      {footer && (
        <Box sx={{ gridArea: 'footer', overflow: 'hidden' }}>{footer}</Box>
      )}
    </Box>
  );
}

AppShell.displayName = 'AppShell';
