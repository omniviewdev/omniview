import React from 'react';
import { Box, IconButton, Stack, Typography } from '@mui/joy';
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
          <Typography level='title-sm'>{title}</Typography>
          <Typography level='body-xs' sx={{ opacity: 0.5 }}>({count})</Typography>
        </Stack>
        {onEdit && (
          <IconButton
            className='folder-edit-btn'
            size='sm'
            variant='plain'
            color='neutral'
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            sx={{ opacity: 0, transition: 'opacity 0.15s', '--IconButton-size': '24px' }}
          >
            <LuPencil size={12} />
          </IconButton>
        )}
      </Stack>
      {!collapsed && (
        isEmpty ? (
          emptyHint ? (
            <Typography level='body-xs' sx={{ py: 2, px: 1, textAlign: 'center', opacity: 0.5 }}>
              {emptyHint}
            </Typography>
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
