import MuiBreadcrumbs from '@mui/material/Breadcrumbs';
import MuiLink from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

export interface BreadcrumbItem {
  label: string;
  href?: string;
  icon?: React.ReactNode;
  onClick?: () => void;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  separator?: React.ReactNode;
  maxItems?: number;
  sx?: SxProps<Theme>;
}

export default function Breadcrumbs({
  items,
  separator,
  maxItems,
  sx,
}: BreadcrumbsProps) {
  return (
    <MuiBreadcrumbs
      separator={separator ?? '/'}
      maxItems={maxItems}
      sx={{
        fontSize: '0.8125rem',
        color: 'var(--ov-fg-muted)',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        const content = (
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
            {item.icon}
            <span>{item.label}</span>
          </Box>
        );

        if (isLast) {
          return (
            <Typography key={i} variant="body2" sx={{ fontSize: 'inherit', color: 'var(--ov-fg-base)', fontWeight: 500 }}>
              {content}
            </Typography>
          );
        }

        if (item.onClick) {
          return (
            <MuiLink
              key={i}
              component="button"
              variant="body2"
              onClick={item.onClick}
              underline="hover"
              sx={{ fontSize: 'inherit', cursor: 'pointer', color: 'inherit' }}
            >
              {content}
            </MuiLink>
          );
        }

        if (item.href) {
          return (
            <MuiLink key={i} href={item.href} variant="body2" underline="hover" sx={{ fontSize: 'inherit', color: 'inherit' }}>
              {content}
            </MuiLink>
          );
        }

        return (
          <Typography key={i} variant="body2" sx={{ fontSize: 'inherit', color: 'inherit' }}>
            {content}
          </Typography>
        );
      })}
    </MuiBreadcrumbs>
  );
}

Breadcrumbs.displayName = 'Breadcrumbs';
