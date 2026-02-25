import Box from '@mui/material/Box';
import MuiChip from '@mui/material/Chip';
import type { SxProps, Theme } from '@mui/material/styles';

export interface ChatSuggestionsProps {
  suggestions: string[];
  onSelect: (suggestion: string) => void;
  sx?: SxProps<Theme>;
}

export default function ChatSuggestions({
  suggestions,
  onSelect,
  sx,
}: ChatSuggestionsProps) {
  if (!suggestions.length) return null;

  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 0.75,
        px: 1.5,
        py: 1,
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {suggestions.map((s) => (
        <MuiChip
          key={s}
          label={s}
          size="small"
          variant="outlined"
          onClick={() => onSelect(s)}
          sx={{
            borderColor: 'var(--ov-border-default)',
            color: 'var(--ov-fg-default)',
            fontSize: 'var(--ov-text-xs)',
            '&:hover': {
              bgcolor: 'var(--ov-state-hover)',
              borderColor: 'var(--ov-accent)',
            },
          }}
        />
      ))}
    </Box>
  );
}

ChatSuggestions.displayName = 'ChatSuggestions';
