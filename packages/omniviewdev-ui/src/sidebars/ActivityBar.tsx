import Box from '@mui/material/Box';
import MuiTooltip from '@mui/material/Tooltip';
import type { SxProps, Theme } from '@mui/material/styles';

import type { ActivityBarItem } from './types';

export interface ActivityBarProps {
  items: ActivityBarItem[];
  activeId?: string;
  onChange?: (id: string) => void;
  position?: 'left' | 'right';
  bottomItems?: ActivityBarItem[];
  width?: number;
  sx?: SxProps<Theme>;
}

function BadgeDot({ count }: { count?: number | boolean }) {
  if (!count) return null;
  if (count === true) {
    return (
      <Box
        sx={{
          position: 'absolute',
          top: 6,
          right: 6,
          width: 8,
          height: 8,
          borderRadius: '50%',
          bgcolor: 'var(--ov-accent-fg)',
          border: '2px solid var(--ov-bg-surface)',
        }}
      />
    );
  }
  return (
    <Box
      sx={{
        position: 'absolute',
        top: 4,
        right: 4,
        minWidth: 16,
        height: 16,
        borderRadius: 8,
        bgcolor: 'var(--ov-accent-fg)',
        color: '#fff',
        fontSize: 10,
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        px: 0.5,
        border: '2px solid var(--ov-bg-surface)',
      }}
    >
      {count > 99 ? '99+' : count}
    </Box>
  );
}

function ActivityBarButton({
  item,
  active,
  onClick,
  position,
}: {
  item: ActivityBarItem;
  active: boolean;
  onClick: () => void;
  position: 'left' | 'right';
}) {
  return (
    <MuiTooltip title={item.label} placement={position === 'left' ? 'right' : 'left'}>
      <Box
        onClick={onClick}
        sx={{
          position: 'relative',
          width: '100%',
          aspectRatio: '1',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          color: active ? 'var(--ov-fg-base)' : 'var(--ov-fg-muted)',
          opacity: active ? 1 : 0.7,
          '&:hover': { opacity: 1, color: 'var(--ov-fg-base)' },
          '&::before': active
            ? {
                content: '""',
                position: 'absolute',
                [position === 'left' ? 'left' : 'right']: 0,
                top: '25%',
                height: '50%',
                width: 2,
                borderRadius: 1,
                bgcolor: 'var(--ov-accent-fg)',
              }
            : {},
          transition: 'color 100ms ease, opacity 100ms ease',
          fontSize: 22,
        }}
      >
        {item.icon}
        <BadgeDot count={item.badge} />
      </Box>
    </MuiTooltip>
  );
}

export default function ActivityBar({
  items,
  activeId,
  onChange,
  position = 'left',
  bottomItems,
  width = 48,
  sx,
}: ActivityBarProps) {
  return (
    <Box
      sx={{
        width,
        minWidth: width,
        height: '100%',
        bgcolor: 'var(--ov-bg-surface)',
        borderRight: position === 'left' ? '1px solid var(--ov-border-default)' : undefined,
        borderLeft: position === 'right' ? '1px solid var(--ov-border-default)' : undefined,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        py: 0.5,
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', flex: 1 }}>
        {items.map((item) => (
          <ActivityBarButton
            key={item.id}
            item={item}
            active={activeId === item.id}
            onClick={() => onChange?.(item.id)}
            position={position}
          />
        ))}
      </Box>
      {bottomItems && bottomItems.length > 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
          {bottomItems.map((item) => (
            <ActivityBarButton
              key={item.id}
              item={item}
              active={activeId === item.id}
              onClick={() => onChange?.(item.id)}
              position={position}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}

ActivityBar.displayName = 'ActivityBar';
