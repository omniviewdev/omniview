import React from 'react';
import Box from '@mui/material/Box';
import MuiIconButton from '@mui/material/IconButton';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { LuChevronDown, LuChevronRight, LuGripVertical, LuPencil } from 'react-icons/lu';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getFolderIcon } from '../../utils/folderIcons';

type Props = {
  id: string;
  title: string;
  count: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** 'grid' wraps children in a responsive card grid; 'passthrough' renders children as-is */
  variant?: 'grid' | 'passthrough';
  folderColor?: string;
  folderIcon?: string;
  onEdit?: () => void;
  /** Show section even when empty (for folder drop targets) */
  showEmpty?: boolean;
  emptyHint?: string;
  children: React.ReactNode;
};

const HubSection: React.FC<Props> = ({
  id,
  title,
  count,
  collapsed,
  onToggleCollapse,
  variant = 'grid',
  folderColor,
  folderIcon,
  onEdit,
  showEmpty,
  emptyHint,
  children,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, data: { type: 'section' } });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const isEmpty = count === 0;
  if (isEmpty && !showEmpty) return null;

  const isFolder = !!folderColor || !!folderIcon;
  const FolderIcon = isFolder ? getFolderIcon(folderIcon) : null;

  return (
    <Box
      ref={setNodeRef}
      style={style}
      sx={folderColor ? { borderLeft: `3px solid ${folderColor}`, pl: 0.5 } : undefined}
    >
      <Stack
        direction='row'
        alignItems='center'
        gap={0.5}
        sx={{
          py: 0.5,
          px: 0.5,
          borderRadius: 'sm',
          userSelect: 'none',
          '&:hover .folder-edit-btn': { opacity: 1 },
        }}
      >
        <Box
          {...attributes}
          {...listeners}
          sx={{
            cursor: 'grab',
            display: 'flex',
            alignItems: 'center',
            color: 'neutral.400',
            '&:hover': { color: 'neutral.600' },
            '&:active': { cursor: 'grabbing' },
          }}
        >
          <LuGripVertical size={14} />
        </Box>
        <Stack
          direction='row'
          alignItems='center'
          gap={0.75}
          onClick={onToggleCollapse}
          sx={{
            cursor: 'pointer',
            flex: 1,
            borderRadius: 'sm',
            py: 0.25,
            px: 0.25,
            '&:hover': { backgroundColor: 'background.level1' },
          }}
        >
          {collapsed
            ? <LuChevronRight size={14} />
            : <LuChevronDown size={14} />
          }
          {FolderIcon && (
            <Box sx={{ display: 'flex', color: folderColor }}>
              <FolderIcon size={14} />
            </Box>
          )}
          <Text weight='semibold' size='sm'>{title}</Text>
          <Text size='xs' sx={{ opacity: 0.5 }}>({count})</Text>
        </Stack>
        {onEdit && (
          <MuiIconButton
            className='folder-edit-btn'
            size='small'
            color='default'
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            sx={{ opacity: 0, transition: 'opacity 0.15s', width: 24, height: 24 }}
          >
            <LuPencil size={12} />
          </MuiIconButton>
        )}
      </Stack>
      {!collapsed && (
        isEmpty ? (
          emptyHint ? (
            <Text size='xs' sx={{ py: 2, px: 1, textAlign: 'center', opacity: 0.5 }}>
              {emptyHint}
            </Text>
          ) : null
        ) : variant === 'grid' ? (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 1,
              py: 0.5,
              px: 0.5,
            }}
          >
            {children}
          </Box>
        ) : (
          <Box sx={{ py: 0.5, px: 0.5 }}>
            {children}
          </Box>
        )
      )}
    </Box>
  );
};

export default HubSection;
