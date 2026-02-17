import React from 'react';
import {
  Dropdown,
  IconButton,
  ListDivider,
  ListItemDecorator,
  Menu,
  MenuButton,
  MenuItem,
} from '@mui/joy';
import { MoreVert } from '@mui/icons-material';
import {
  LuPencil,
  LuStar,
  LuPlug,
  LuUnplug,
  LuCopy,
} from 'react-icons/lu';
import { Link } from '@omniviewdev/runtime';

const ICON_SIZE = 12;

type Props = {
  connectionId: string;
  connectionName: string;
  isConnected: boolean;
  isFavorite: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onToggleFavorite: () => void;
  onCopyId: () => void;
};

const ConnectionContextMenu: React.FC<Props> = ({
  connectionId,
  connectionName: _connectionName,
  isConnected,
  isFavorite,
  onConnect,
  onDisconnect,
  onToggleFavorite,
  onCopyId,
}) => {
  const handleMenuClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <Dropdown>
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

        <Link to={`/account/${encodeURIComponent(connectionId)}/edit`} style={{ textDecoration: 'none', color: 'inherit' }}>
          <MenuItem>
            <ListItemDecorator><LuPencil size={ICON_SIZE} /></ListItemDecorator>
            Edit
          </MenuItem>
        </Link>

        <MenuItem onClick={onToggleFavorite}>
          <ListItemDecorator><LuStar size={ICON_SIZE} /></ListItemDecorator>
          {isFavorite ? 'Unfavorite' : 'Favorite'}
        </MenuItem>

        <ListDivider />

        <MenuItem onClick={onCopyId}>
          <ListItemDecorator><LuCopy size={ICON_SIZE} /></ListItemDecorator>
          Copy Connection ID
        </MenuItem>
      </Menu>
    </Dropdown>
  );
};

export default ConnectionContextMenu;
