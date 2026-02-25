import React from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import { LuBot, LuUser } from 'react-icons/lu';

export interface ChatAvatarProps {
  role: 'user' | 'assistant' | 'system';
  src?: string;
  icon?: React.ReactNode;
  status?: 'online' | 'busy' | 'offline';
  size?: number;
  sx?: SxProps<Theme>;
}

const statusColors: Record<NonNullable<ChatAvatarProps['status']>, string> = {
  online: 'var(--ov-success-default)',
  busy: 'var(--ov-warning-default)',
  offline: 'var(--ov-fg-faint)',
};

export default function ChatAvatar({
  role,
  src,
  icon,
  status,
  size = 28,
  sx,
}: ChatAvatarProps) {
  const defaultIcon = role === 'user'
    ? <LuUser size={size * 0.55} />
    : <LuBot size={size * 0.55} />;

  return (
    <Box
      sx={{
        position: 'relative',
        width: size,
        height: size,
        flexShrink: 0,
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {src ? (
        <Box
          component="img"
          src={src}
          alt={role}
          sx={{
            width: size,
            height: size,
            borderRadius: '50%',
            objectFit: 'cover',
          }}
        />
      ) : (
        <Box
          sx={{
            width: size,
            height: size,
            borderRadius: '50%',
            bgcolor: role === 'user' ? 'var(--ov-accent)' : 'var(--ov-bg-surface-inset)',
            color: role === 'user' ? '#fff' : 'var(--ov-fg-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {icon ?? defaultIcon}
        </Box>
      )}

      {status && (
        <Box
          sx={{
            position: 'absolute',
            bottom: -1,
            right: -1,
            width: 8,
            height: 8,
            borderRadius: '50%',
            bgcolor: statusColors[status],
            border: '1.5px solid var(--ov-bg-surface)',
          }}
        />
      )}
    </Box>
  );
}

ChatAvatar.displayName = 'ChatAvatar';
