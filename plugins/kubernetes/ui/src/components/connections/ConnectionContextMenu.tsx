import React, { useState } from 'react';
import Box from '@mui/material/Box';
import { IconButton } from '@omniviewdev/ui/buttons';
import { Text } from '@omniviewdev/ui/typography';
import Divider from '@mui/material/Divider';
import { MoreVert } from '@mui/icons-material';
import {
  LuPencil,
  LuTrash,
  LuStar,
  LuPlug,
  LuUnplug,
  LuCopy,
  LuFolder,
  LuFolderPlus,
  LuCheck,
  LuChevronDown,
  LuChevronRight,
} from 'react-icons/lu';
import { Link } from '@omniviewdev/runtime';
import type { ConnectionGroup } from '../../types/clusters';
import { getFolderIcon } from '../../utils/folderIcons';

const ICON_SIZE = 12;

type Props = {
  connectionId: string;
  connectionName: string;
  isConnected: boolean;
  isFavorite: boolean;
  customGroups: ConnectionGroup[];
  onConnect: () => void;
  onDisconnect: () => void;
  onToggleFavorite: () => void;
  onAssignToGroup: (groupId: string) => void;
  onRemoveFromGroup?: (groupId: string) => void;
  onCreateFolder?: (connectionId: string) => void;
  onCopyId: () => void;
  onDelete: () => void;
};

const ConnectionContextMenu: React.FC<Props> = ({
  connectionId,
  connectionName,
  isConnected,
  isFavorite,
  customGroups,
  onConnect,
  onDisconnect,
  onToggleFavorite,
  onAssignToGroup,
  onRemoveFromGroup,
  onCreateFolder,
  onCopyId,
  onDelete,
}) => {
  const [foldersExpanded, setFoldersExpanded] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const handleMenuClick = (e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    setAnchorEl(e.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
    setFoldersExpanded(false);
  };

  // Truncate long names for the delete label
  const deleteName = connectionName.length > 30
    ? `${connectionName.slice(0, 30)}...`
    : connectionName;

  return (
    <>
      <IconButton
        aria-label='More'
        size='sm'
        emphasis='ghost'
        color='neutral'
        onClick={handleMenuClick}
      >
        <MoreVert sx={{ fontSize: 16 }} />
      </IconButton>
      {/* Note: This menu structure is simplified since DropdownMenu from @omniviewdev/ui/menus
          may have a different API. Using basic Box-based menu as fallback. */}
      {open && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 999 }}
            onClick={handleClose}
          />
          <Box
            sx={{
              position: 'absolute',
              right: 0,
              top: '100%',
              zIndex: 1000,
              borderRadius: 'var(--ov-radius-md, 6px)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
              bgcolor: 'var(--ov-bg-surface, #1e1e1e)',
              border: '1px solid var(--ov-border-default, rgba(255,255,255,0.08))',
              minWidth: 150,
              fontSize: '0.75rem',
              py: 0.375,
            }}
          >
            {isConnected ? (
              <Box
                onClick={() => { onDisconnect(); handleClose(); }}
                sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 0.75, py: 0.25, cursor: 'pointer', '&:hover': { bgcolor: 'var(--ov-bg-surface-hover, rgba(255,255,255,0.05))' } }}
              >
                <LuUnplug size={ICON_SIZE} />
                Disconnect
              </Box>
            ) : (
              <Box
                onClick={() => { onConnect(); handleClose(); }}
                sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 0.75, py: 0.25, cursor: 'pointer', '&:hover': { bgcolor: 'var(--ov-bg-surface-hover, rgba(255,255,255,0.05))' } }}
              >
                <LuPlug size={ICON_SIZE} />
                Connect
              </Box>
            )}

            <Divider sx={{ my: 0.5 }} />

            <Link to={`/cluster/${encodeURIComponent(connectionId)}/edit`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <Box
                onClick={handleClose}
                sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 0.75, py: 0.25, cursor: 'pointer', '&:hover': { bgcolor: 'var(--ov-bg-surface-hover, rgba(255,255,255,0.05))' } }}
              >
                <LuPencil size={ICON_SIZE} />
                Edit
              </Box>
            </Link>

            <Box
              onClick={() => { onToggleFavorite(); handleClose(); }}
              sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 0.75, py: 0.25, cursor: 'pointer', '&:hover': { bgcolor: 'var(--ov-bg-surface-hover, rgba(255,255,255,0.05))' } }}
            >
              <LuStar size={ICON_SIZE} />
              {isFavorite ? 'Unfavorite' : 'Favorite'}
            </Box>

            {(customGroups.length > 0 || onCreateFolder) && (
              <>
                <Divider sx={{ my: 0.5 }} />
                <Box
                  role='menuitem'
                  tabIndex={0}
                  onClick={() => setFoldersExpanded(prev => !prev)}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    px: 1,
                    py: 0.5,
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'var(--ov-bg-surface-hover, rgba(255,255,255,0.05))' },
                  }}
                >
                  <LuFolder size={ICON_SIZE} />
                  <Text sx={{ flex: 1, fontSize: 'inherit' }}>Folders</Text>
                  {foldersExpanded
                    ? <LuChevronDown size={ICON_SIZE} style={{ opacity: 0.5, marginLeft: 6 }} />
                    : <LuChevronRight size={ICON_SIZE} style={{ opacity: 0.5, marginLeft: 6 }} />
                  }
                </Box>
                {foldersExpanded && (
                  <>
                    {customGroups.map(group => {
                      const isInGroup = group.connectionIds.includes(connectionId);
                      const Icon = getFolderIcon(group.icon);
                      return (
                        <Box
                          key={group.id}
                          onClick={() => {
                            if (isInGroup && onRemoveFromGroup) {
                              onRemoveFromGroup(group.id);
                            } else if (!isInGroup) {
                              onAssignToGroup(group.id);
                            }
                            handleClose();
                          }}
                          sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 3, pr: 0.75, py: 0.25, cursor: 'pointer', '&:hover': { bgcolor: 'var(--ov-bg-surface-hover, rgba(255,255,255,0.05))' } }}
                        >
                          <Box sx={{ color: group.color }}>
                            {isInGroup ? <LuCheck size={ICON_SIZE} /> : <Icon size={ICON_SIZE} />}
                          </Box>
                          {group.name}
                        </Box>
                      );
                    })}
                    {onCreateFolder && (
                      <Box
                        onClick={() => { onCreateFolder(connectionId); handleClose(); }}
                        sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 3, pr: 0.75, py: 0.25, cursor: 'pointer', '&:hover': { bgcolor: 'var(--ov-bg-surface-hover, rgba(255,255,255,0.05))' } }}
                      >
                        <LuFolderPlus size={ICON_SIZE} />
                        New Folder...
                      </Box>
                    )}
                  </>
                )}
              </>
            )}

            <Divider sx={{ my: 0.5 }} />

            <Box
              onClick={() => { onCopyId(); handleClose(); }}
              sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 0.75, py: 0.25, cursor: 'pointer', '&:hover': { bgcolor: 'var(--ov-bg-surface-hover, rgba(255,255,255,0.05))' } }}
            >
              <LuCopy size={ICON_SIZE} />
              Copy Connection ID
            </Box>

            <Divider sx={{ my: 0.5 }} />

            <Box
              onClick={() => { onDelete(); handleClose(); }}
              sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 0.75, py: 0.25, cursor: 'pointer', color: 'error.main', '&:hover': { bgcolor: 'var(--ov-bg-surface-hover, rgba(255,255,255,0.05))' } }}
            >
              <LuTrash size={ICON_SIZE} />
              Delete '{deleteName}'
            </Box>
          </Box>
        </>
      )}
    </>
  );
};

export default ConnectionContextMenu;
