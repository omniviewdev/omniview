import React, { useState } from 'react';
import {
  Box,
  Dropdown,
  IconButton,
  ListDivider,
  ListItemDecorator,
  Menu,
  MenuButton,
  MenuItem,
  Typography,
} from '@mui/joy';
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

  const handleMenuClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  // Truncate long names for the delete label
  const deleteName = connectionName.length > 30
    ? `${connectionName.slice(0, 30)}...`
    : connectionName;

  return (
    <Dropdown onOpenChange={(_e, open) => { if (!open) setFoldersExpanded(false); }}>
      <MenuButton
        aria-label='More'
        size='sm'
        slots={{ root: IconButton }}
        slotProps={{ root: { variant: 'plain', color: 'neutral', size: 'sm' } }}
        onClick={handleMenuClick}
      >
        <MoreVert sx={{ fontSize: 18 }} />
      </MenuButton>
      <Menu
        size='sm'
        placement='bottom-end'
        sx={{
          fontSize: '0.75rem',
          '--List-padding': '3px',
          '--ListItem-minHeight': '28px',
          '--ListItemDecorator-size': '22px',
          '--ListItem-paddingY': '2px',
          '--ListItem-paddingX': '6px',
          '--ListDivider-gap': '3px',
          minWidth: 160,
        }}
      >
        {isConnected ? (
          <MenuItem onClick={onDisconnect}>
            <ListItemDecorator><LuUnplug size={ICON_SIZE} /></ListItemDecorator>
            Disconnect
          </MenuItem>
        ) : (
          <MenuItem onClick={onConnect}>
            <ListItemDecorator><LuPlug size={ICON_SIZE} /></ListItemDecorator>
            Connect
          </MenuItem>
        )}

        <ListDivider />

        <Link to={`/cluster/${encodeURIComponent(connectionId)}/edit`} style={{ textDecoration: 'none', color: 'inherit' }}>
          <MenuItem>
            <ListItemDecorator><LuPencil size={ICON_SIZE} /></ListItemDecorator>
            Edit
          </MenuItem>
        </Link>

        <MenuItem onClick={onToggleFavorite}>
          <ListItemDecorator><LuStar size={ICON_SIZE} /></ListItemDecorator>
          {isFavorite ? 'Unfavorite' : 'Favorite'}
        </MenuItem>

        {(customGroups.length > 0 || onCreateFolder) && (
          <>
            <ListDivider />
            {/* Folders toggle — uses a plain Box so it doesn't auto-close the menu */}
            <Box
              role='menuitem'
              tabIndex={0}
              onClick={() => setFoldersExpanded(prev => !prev)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                minHeight: 'var(--ListItem-minHeight)',
                py: 'var(--ListItem-paddingY)',
                px: 'var(--ListItem-paddingX)',
                fontSize: 'inherit',
                cursor: 'pointer',
                borderRadius: 'var(--ListItem-radius)',
                '&:hover': { bgcolor: 'neutral.plainHoverBg' },
              }}
            >
              <Box component='span' sx={{ display: 'inline-flex', minWidth: 'var(--ListItemDecorator-size)', alignItems: 'center' }}>
                <LuFolder size={ICON_SIZE} />
              </Box>
              <Typography sx={{ flex: 1, fontSize: 'inherit' }}>Folders</Typography>
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
                    <MenuItem
                      key={group.id}
                      onClick={() => {
                        if (isInGroup && onRemoveFromGroup) {
                          onRemoveFromGroup(group.id);
                        } else if (!isInGroup) {
                          onAssignToGroup(group.id);
                        }
                      }}
                      sx={{ pl: 3.5 }}
                    >
                      <ListItemDecorator sx={{ color: group.color }}>
                        {isInGroup ? <LuCheck size={ICON_SIZE} /> : <Icon size={ICON_SIZE} />}
                      </ListItemDecorator>
                      {group.name}
                    </MenuItem>
                  );
                })}
                {onCreateFolder && (
                  <MenuItem onClick={() => onCreateFolder(connectionId)} sx={{ pl: 3.5 }}>
                    <ListItemDecorator><LuFolderPlus size={ICON_SIZE} /></ListItemDecorator>
                    New Folder...
                  </MenuItem>
                )}
              </>
            )}
          </>
        )}

        <ListDivider />

        <MenuItem onClick={onCopyId}>
          <ListItemDecorator><LuCopy size={ICON_SIZE} /></ListItemDecorator>
          Copy Connection ID
        </MenuItem>

        <ListDivider />

        <MenuItem color='danger' onClick={onDelete}>
          <ListItemDecorator><LuTrash size={ICON_SIZE} /></ListItemDecorator>
          Delete '{deleteName}'
        </MenuItem>
      </Menu>
    </Dropdown>
  );
};

export default ConnectionContextMenu;
