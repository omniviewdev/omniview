import { useState, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import MuiIconButton from '@mui/material/IconButton';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import type { SxProps, Theme } from '@mui/material/styles';

export interface ConversationSummary {
  id: string;
  title: string;
  lastMessage: string;
  timestamp: string;
  messageCount: number;
  modelId?: string;
}

export interface ChatHistoryProps {
  conversations: ConversationSummary[];
  activeId?: string;
  onSelect: (id: string) => void;
  onDelete?: (id: string) => void;
  sx?: SxProps<Theme>;
}

function groupByDate(conversations: ConversationSummary[]): Record<string, ConversationSummary[]> {
  const groups: Record<string, ConversationSummary[]> = {};
  const now = new Date();
  const today = now.toDateString();
  const yesterday = new Date(now.getTime() - 86400000).toDateString();

  for (const c of conversations) {
    const d = new Date(c.timestamp);
    const ds = d.toDateString();
    let label: string;
    if (ds === today) label = 'Today';
    else if (ds === yesterday) label = 'Yesterday';
    else if (now.getTime() - d.getTime() < 604800000) label = 'This Week';
    else label = 'Older';

    (groups[label] ??= []).push(c);
  }
  return groups;
}

export default function ChatHistory({
  conversations,
  activeId,
  onSelect,
  onDelete,
  sx,
}: ChatHistoryProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search) return conversations;
    const q = search.toLowerCase();
    return conversations.filter(
      (c) => c.title.toLowerCase().includes(q) || c.lastMessage.toLowerCase().includes(q),
    );
  }, [conversations, search]);

  const groups = useMemo(() => groupByDate(filtered), [filtered]);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {/* Search */}
      <Box sx={{ px: 1.5, py: 1, borderBottom: '1px solid var(--ov-border-default)' }}>
        <Box
          component="input"
          value={search}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
          placeholder="Search conversations..."
          sx={{
            width: '100%',
            border: '1px solid var(--ov-border-default)',
            borderRadius: '6px',
            bgcolor: 'var(--ov-bg-surface-inset)',
            color: 'var(--ov-fg-default)',
            fontFamily: 'var(--ov-font-ui)',
            fontSize: 'var(--ov-text-sm)',
            px: 1,
            py: 0.5,
            outline: 'none',
            '&:focus': { borderColor: 'var(--ov-accent)' },
            '&::placeholder': { color: 'var(--ov-fg-faint)' },
          }}
        />
      </Box>

      {/* List */}
      <Box sx={{ flex: 1, overflow: 'auto', py: 0.5 }}>
        {Object.entries(groups).map(([label, items]) => (
          <Box key={label} sx={{ mb: 1 }}>
            <Typography
              sx={{
                fontSize: 'var(--ov-text-xs)',
                fontWeight: 600,
                color: 'var(--ov-fg-faint)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                px: 1.5,
                py: 0.5,
              }}
            >
              {label}
            </Typography>

            {items.map((c) => (
              <Box
                key={c.id}
                onClick={() => onSelect(c.id)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 1.5,
                  py: 0.75,
                  cursor: 'pointer',
                  borderRadius: '4px',
                  mx: 0.5,
                  bgcolor: c.id === activeId ? 'var(--ov-accent-subtle)' : 'transparent',
                  '&:hover': {
                    bgcolor: c.id === activeId ? 'var(--ov-accent-subtle)' : 'var(--ov-state-hover)',
                    '& .chat-history-delete': { opacity: 1 },
                  },
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography
                    sx={{
                      fontSize: 'var(--ov-text-sm)',
                      fontWeight: c.id === activeId ? 600 : 400,
                      color: c.id === activeId ? 'var(--ov-accent-fg)' : 'var(--ov-fg-default)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {c.title}
                  </Typography>
                  <Typography
                    sx={{
                      fontSize: 'var(--ov-text-xs)',
                      color: 'var(--ov-fg-faint)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {c.lastMessage}
                  </Typography>
                </Box>

                {onDelete && (
                  <MuiIconButton
                    className="chat-history-delete"
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(c.id);
                    }}
                    sx={{
                      opacity: 0,
                      transition: 'opacity 150ms',
                      color: 'var(--ov-fg-faint)',
                      '&:hover': { color: 'var(--ov-danger-default)' },
                    }}
                  >
                    <DeleteOutlineIcon sx={{ fontSize: 14 }} />
                  </MuiIconButton>
                )}
              </Box>
            ))}
          </Box>
        ))}

        {filtered.length === 0 && (
          <Typography
            sx={{
              fontSize: 'var(--ov-text-sm)',
              color: 'var(--ov-fg-faint)',
              textAlign: 'center',
              py: 4,
            }}
          >
            No conversations found
          </Typography>
        )}
      </Box>
    </Box>
  );
}

ChatHistory.displayName = 'ChatHistory';
