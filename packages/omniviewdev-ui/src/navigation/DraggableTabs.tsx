import React, { useCallback } from 'react';
import Box from '@mui/material/Box';
import MuiIconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import { LuX, LuPlus } from 'react-icons/lu';
import type { SxProps, Theme } from '@mui/material/styles';

export interface DraggableTab {
  id: string;
  label: string;
  icon?: React.ReactNode;
  closable?: boolean;
}

export interface DraggableTabsProps {
  tabs: DraggableTab[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose?: (id: string) => void;
  onReorder?: (tabs: DraggableTab[]) => void;
  onAdd?: () => void;
  onContextMenu?: (id: string, event: React.MouseEvent) => void;
  maxTabWidth?: number;
  sx?: SxProps<Theme>;
}

export default function DraggableTabs({
  tabs,
  activeId,
  onSelect,
  onClose,
  onReorder,
  onAdd,
  onContextMenu,
  maxTabWidth = 180,
  sx,
}: DraggableTabsProps) {
  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    e.dataTransfer.setData('text/plain', String(index));
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    const dragIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (isNaN(dragIndex) || dragIndex === dropIndex || !onReorder) return;

    const newTabs = [...tabs];
    const [removed] = newTabs.splice(dragIndex, 1);
    newTabs.splice(dropIndex, 0, removed);
    onReorder(newTabs);
  }, [tabs, onReorder]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'end',
        height: 36,
        overflow: 'auto',
        bgcolor: 'var(--ov-bg-surface)',
        borderBottom: '1px solid var(--ov-border-default)',
        scrollbarWidth: 'none',
        '&::-webkit-scrollbar': { display: 'none' },
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeId;
        return (
          <Box
            key={tab.id}
            draggable={!!onReorder}
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, index)}
            onContextMenu={(e) => { if (onContextMenu) { e.preventDefault(); onContextMenu(tab.id, e); } }}
            onClick={() => onSelect(tab.id)}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              maxWidth: maxTabWidth,
              height: isActive ? 35 : 32,
              px: 1.5,
              cursor: 'pointer',
              flexShrink: 0,
              borderBottom: isActive ? '2px solid var(--ov-accent)' : '2px solid transparent',
              bgcolor: isActive ? 'var(--ov-bg-base)' : 'transparent',
              color: isActive ? 'var(--ov-fg-base)' : 'var(--ov-fg-muted)',
              '&:hover': {
                bgcolor: isActive ? 'var(--ov-bg-base)' : 'var(--ov-state-hover)',
                '& .tab-close': { opacity: 1 },
              },
            }}
          >
            {tab.icon && (
              <Box sx={{ display: 'flex', flexShrink: 0, fontSize: 14 }}>
                {tab.icon}
              </Box>
            )}
            <Typography
              noWrap
              sx={{
                fontSize: 'var(--ov-text-xs)',
                fontWeight: isActive ? 500 : 400,
                flex: 1,
                minWidth: 0,
              }}
            >
              {tab.label}
            </Typography>
            {(tab.closable !== false) && onClose && (
              <MuiIconButton
                className="tab-close"
                size="small"
                onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
                sx={{
                  p: '1px',
                  opacity: isActive ? 0.7 : 0,
                  color: 'inherit',
                  '&:hover': { opacity: 1, bgcolor: 'var(--ov-state-hover)' },
                }}
              >
                <LuX size={12} />
              </MuiIconButton>
            )}
          </Box>
        );
      })}

      {onAdd && (
        <MuiIconButton
          size="small"
          onClick={onAdd}
          sx={{
            mx: 0.5,
            p: '4px',
            color: 'var(--ov-fg-muted)',
            '&:hover': { bgcolor: 'var(--ov-state-hover)' },
          }}
        >
          <LuPlus size={14} />
        </MuiIconButton>
      )}
    </Box>
  );
}

DraggableTabs.displayName = 'DraggableTabs';
