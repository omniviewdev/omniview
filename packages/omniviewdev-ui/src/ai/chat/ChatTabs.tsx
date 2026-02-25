import Box from '@mui/material/Box';
import MuiIconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import type { SxProps, Theme } from '@mui/material/styles';

export interface ChatTab {
  id: string;
  label: string;
}

export interface ChatTabsProps {
  tabs: ChatTab[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose?: (id: string) => void;
  onNew?: () => void;
  sx?: SxProps<Theme>;
}

export default function ChatTabs({
  tabs,
  activeId,
  onSelect,
  onClose,
  onNew,
  sx,
}: ChatTabsProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        borderBottom: '1px solid var(--ov-border-default)',
        bgcolor: 'var(--ov-bg-surface)',
        overflow: 'auto',
        minHeight: 32,
        '&::-webkit-scrollbar': { display: 'none' },
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        return (
          <Box
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              px: 1.5,
              py: 0.5,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              borderBottom: isActive ? '2px solid var(--ov-accent)' : '2px solid transparent',
              color: isActive ? 'var(--ov-accent-fg)' : 'var(--ov-fg-muted)',
              '&:hover': {
                bgcolor: 'var(--ov-state-hover)',
                '& .chat-tab-close': { opacity: 1 },
              },
            }}
          >
            <Typography
              sx={{
                fontSize: 'var(--ov-text-xs)',
                fontWeight: isActive ? 600 : 400,
              }}
            >
              {tab.label}
            </Typography>
            {onClose && (
              <MuiIconButton
                className="chat-tab-close"
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
                sx={{
                  opacity: isActive ? 0.7 : 0,
                  transition: 'opacity 150ms',
                  p: 0.25,
                  color: 'var(--ov-fg-faint)',
                  '&:hover': { color: 'var(--ov-fg-default)' },
                }}
              >
                <CloseIcon sx={{ fontSize: 12 }} />
              </MuiIconButton>
            )}
          </Box>
        );
      })}

      {onNew && (
        <MuiIconButton
          size="small"
          onClick={onNew}
          sx={{
            mx: 0.5,
            color: 'var(--ov-fg-faint)',
            '&:hover': { color: 'var(--ov-fg-default)' },
          }}
        >
          <AddIcon sx={{ fontSize: 16 }} />
        </MuiIconButton>
      )}
    </Box>
  );
}

ChatTabs.displayName = 'ChatTabs';
