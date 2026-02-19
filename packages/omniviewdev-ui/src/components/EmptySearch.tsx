import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import SearchIcon from '@mui/icons-material/Search';
import type { SxProps, Theme } from '@mui/material/styles';

export interface EmptySearchProps {
  query: string;
  suggestions?: string[];
  onSuggestionClick?: (suggestion: string) => void;
  sx?: SxProps<Theme>;
}

export default function EmptySearch({
  query,
  suggestions,
  onSuggestionClick,
  sx,
}: EmptySearchProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        py: 4,
        gap: 1.5,
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      <SearchIcon sx={{ fontSize: 32, color: 'var(--ov-fg-faint)' }} />
      <Typography sx={{ fontSize: 'var(--ov-text-sm)', color: 'var(--ov-fg-muted)' }}>
        No results for &ldquo;{query}&rdquo;
      </Typography>

      {suggestions && suggestions.length > 0 && (
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', justifyContent: 'center', mt: 0.5 }}>
          <Typography sx={{ fontSize: 'var(--ov-text-xs)', color: 'var(--ov-fg-faint)', width: '100%', textAlign: 'center' }}>
            Try:
          </Typography>
          {suggestions.map((s) => (
            <Chip
              key={s}
              label={s}
              size="small"
              onClick={onSuggestionClick ? () => onSuggestionClick(s) : undefined}
              sx={{
                fontSize: 'var(--ov-text-xs)',
                cursor: onSuggestionClick ? 'pointer' : 'default',
                bgcolor: 'var(--ov-bg-surface-inset)',
                color: 'var(--ov-fg-muted)',
              }}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}

EmptySearch.displayName = 'EmptySearch';
