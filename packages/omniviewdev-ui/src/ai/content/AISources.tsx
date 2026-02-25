import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { LuExternalLink } from 'react-icons/lu';

export interface AISource {
  title: string;
  url?: string;
  description?: string;
}

export interface AISourcesProps {
  sources: AISource[];
  label?: string;
  sx?: SxProps<Theme>;
}

export default function AISources({
  sources,
  label = 'Sources',
  sx,
}: AISourcesProps) {
  if (!sources.length) return null;

  return (
    <Box
      sx={{
        borderRadius: '6px',
        border: '1px solid var(--ov-border-default)',
        bgcolor: 'var(--ov-bg-surface)',
        overflow: 'hidden',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      <Typography
        sx={{
          fontSize: 'var(--ov-text-xs)',
          fontWeight: 600,
          color: 'var(--ov-fg-muted)',
          px: 1.5,
          py: 0.75,
          borderBottom: '1px solid var(--ov-border-default)',
        }}
      >
        {label}
      </Typography>

      {sources.map((src, i) => (
        <Box
          key={i}
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 1,
            px: 1.5,
            py: 0.75,
            '&:not(:last-child)': {
              borderBottom: '1px solid var(--ov-border-muted)',
            },
            '&:hover': { bgcolor: 'var(--ov-state-hover)' },
          }}
        >
          <Typography
            sx={{
              fontSize: 'var(--ov-text-xs)',
              color: 'var(--ov-fg-faint)',
              fontWeight: 600,
              mt: '1px',
              minWidth: 16,
            }}
          >
            {i + 1}.
          </Typography>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {src.url ? (
              <Box
                component="a"
                href={src.url}
                target="_blank"
                rel="noopener noreferrer"
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.5,
                  fontSize: 'var(--ov-text-sm)',
                  color: 'var(--ov-accent-fg)',
                  textDecoration: 'none',
                  '&:hover': { textDecoration: 'underline' },
                }}
              >
                {src.title}
                <LuExternalLink size={11} />
              </Box>
            ) : (
              <Typography
                sx={{
                  fontSize: 'var(--ov-text-sm)',
                  color: 'var(--ov-fg-default)',
                }}
              >
                {src.title}
              </Typography>
            )}
            {src.description && (
              <Typography
                sx={{
                  fontSize: 'var(--ov-text-xs)',
                  color: 'var(--ov-fg-muted)',
                  mt: 0.25,
                }}
              >
                {src.description}
              </Typography>
            )}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

AISources.displayName = 'AISources';
