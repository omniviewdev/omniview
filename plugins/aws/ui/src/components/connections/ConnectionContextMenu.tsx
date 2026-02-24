import React from 'react';
import Divider from '@mui/material/Divider';
import ListItemIcon from '@mui/material/ListItemIcon';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { IconButton } from '@omniviewdev/ui/buttons';
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
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const handleMenuClick = (e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    setAnchorEl(e.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  return (
    <>
      <IconButton
        aria-label='More'
        size='sm'
        emphasis='ghost'
        color='neutral'
        onClick={handleMenuClick}
      >
        <MoreVert sx={{ fontSize: 18 }} />
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        slotProps={{
          paper: {
            sx: {
              fontSize: '0.75rem',
              minWidth: 160,
            },
          },
        }}
      >
        {isConnected ? (
          <MenuItem onClick={() => { onDisconnect(); handleClose(); }} sx={{ fontSize: '0.75rem' }}>
            <ListItemIcon><LuUnplug size={ICON_SIZE} /></ListItemIcon>
            Disconnect
          </MenuItem>
        ) : (
          <MenuItem onClick={() => { onConnect(); handleClose(); }} sx={{ fontSize: '0.75rem' }}>
            <ListItemIcon><LuPlug size={ICON_SIZE} /></ListItemIcon>
            Connect
          </MenuItem>
        )}

        <Divider />

        <Link to={`/account/${encodeURIComponent(connectionId)}/edit`} style={{ textDecoration: 'none', color: 'inherit' }}>
          <MenuItem onClick={handleClose} sx={{ fontSize: '0.75rem' }}>
            <ListItemIcon><LuPencil size={ICON_SIZE} /></ListItemIcon>
            Edit
          </MenuItem>
        </Link>

        <MenuItem onClick={() => { onToggleFavorite(); handleClose(); }} sx={{ fontSize: '0.75rem' }}>
          <ListItemIcon><LuStar size={ICON_SIZE} /></ListItemIcon>
          {isFavorite ? 'Unfavorite' : 'Favorite'}
        </MenuItem>

        <Divider />

        <MenuItem onClick={() => { onCopyId(); handleClose(); }} sx={{ fontSize: '0.75rem' }}>
          <ListItemIcon><LuCopy size={ICON_SIZE} /></ListItemIcon>
          Copy Connection ID
        </MenuItem>
      </Menu>
    </>
  );
};

export default ConnectionContextMenu;
