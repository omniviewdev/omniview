import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import LinkIcon from '@mui/icons-material/Link';
import type { SxProps, Theme } from '@mui/material/styles';

export interface HeadingProps {
  children: React.ReactNode;
  level?: 1 | 2 | 3 | 4 | 5 | 6 | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  id?: string;
  copyLink?: boolean;
  sx?: SxProps<Theme>;
}

const levelToVariant: Record<number, 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'> = {
  1: 'h1',
  2: 'h2',
  3: 'h3',
  4: 'h4',
  5: 'h5',
  6: 'h6',
};

export default function Heading({
  children,
  level = 2,
  id,
  copyLink = false,
  sx,
}: HeadingProps) {
  const resolvedLevel = typeof level === 'string'
    ? parseInt(level.replace('h', ''), 10) as 1 | 2 | 3 | 4 | 5 | 6
    : level;
  const variant = levelToVariant[resolvedLevel];

  const handleCopyLink = () => {
    if (id) {
      const url = `${window.location.origin}${window.location.pathname}#${id}`;
      navigator.clipboard.writeText(url);
    }
  };

  return (
    <Typography
      variant={variant}
      id={id}
      sx={{
        color: 'var(--ov-fg-base)',
        fontWeight: 'var(--ov-weight-semibold)',
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        '&:hover .ov-heading-anchor': { opacity: 1 },
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {children}
      {copyLink && id && (
        <Box
          component="button"
          className="ov-heading-anchor"
          onClick={handleCopyLink}
          sx={{
            opacity: 0,
            transition: 'opacity 150ms',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--ov-fg-faint)',
            display: 'inline-flex',
            p: 0,
            '&:hover': { color: 'var(--ov-fg-default)' },
          }}
        >
          <LinkIcon sx={{ fontSize: '0.7em' }} />
        </Box>
      )}
    </Typography>
  );
}

Heading.displayName = 'Heading';
