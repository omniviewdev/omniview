import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import MuiIconButton from '@mui/material/IconButton';
import MuiChip from '@mui/material/Chip';
import AddIcon from '@mui/icons-material/Add';
import HistoryIcon from '@mui/icons-material/History';
import CloseIcon from '@mui/icons-material/Close';
import type { SxProps, Theme } from '@mui/material/styles';

export interface ChatHeaderProps {
  modelName?: string;
  tokenCount?: number;
  maxTokens?: number;
  onNewConversation?: () => void;
  onToggleHistory?: () => void;
  onClose?: () => void;
  sx?: SxProps<Theme>;
}

export default function ChatHeader({
  modelName,
  tokenCount,
  maxTokens,
  onNewConversation,
  onToggleHistory,
  onClose,
  sx,
}: ChatHeaderProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1.5,
        py: 1,
        borderBottom: '1px solid var(--ov-border-default)',
        bgcolor: 'var(--ov-bg-surface)',
        minHeight: 44,
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {onToggleHistory && (
        <MuiIconButton
          size="small"
          onClick={onToggleHistory}
          aria-label="Toggle history"
          sx={{ color: 'var(--ov-fg-muted)' }}
        >
          <HistoryIcon sx={{ fontSize: 18 }} />
        </MuiIconButton>
      )}

      {modelName && (
        <MuiChip
          label={modelName}
          size="small"
          variant="outlined"
          sx={{
            borderColor: 'var(--ov-border-default)',
            color: 'var(--ov-fg-default)',
            fontSize: 'var(--ov-text-xs)',
            height: 22,
          }}
        />
      )}

      {tokenCount !== undefined && (
        <Typography
          sx={{
            fontSize: 'var(--ov-text-xs)',
            color: maxTokens && tokenCount > maxTokens * 0.8
              ? 'var(--ov-warning-default)'
              : 'var(--ov-fg-faint)',
            fontFamily: 'var(--ov-font-mono)',
          }}
        >
          {tokenCount.toLocaleString()}
          {maxTokens ? ` / ${maxTokens.toLocaleString()}` : ''} tokens
        </Typography>
      )}

      <Box sx={{ flex: 1 }} />

      {onNewConversation && (
        <MuiIconButton
          size="small"
          onClick={onNewConversation}
          aria-label="New conversation"
          sx={{ color: 'var(--ov-fg-muted)', '&:hover': { color: 'var(--ov-accent)' } }}
        >
          <AddIcon sx={{ fontSize: 18 }} />
        </MuiIconButton>
      )}

      {onClose && (
        <MuiIconButton
          size="small"
          onClick={onClose}
          aria-label="Close"
          sx={{ color: 'var(--ov-fg-muted)' }}
        >
          <CloseIcon sx={{ fontSize: 18 }} />
        </MuiIconButton>
      )}
    </Box>
  );
}

ChatHeader.displayName = 'ChatHeader';
