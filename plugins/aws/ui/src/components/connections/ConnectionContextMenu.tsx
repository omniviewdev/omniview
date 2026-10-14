import React from 'react';
import { IconButton, Menu } from '@omniviewdev/base-ui';
import {
  LuEllipsisVertical,
  LuPencil,
  LuStar,
  LuPlug,
  LuUnplug,
  LuCopy,
} from 'react-icons/lu';
import { usePluginRouter } from '@omniviewdev/runtime';

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

const popupStyle: React.CSSProperties = { fontSize: '0.75rem', minWidth: 160 };

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
  const { navigate } = usePluginRouter();

  return (
    <Menu.Root size='sm'>
      <Menu.Trigger
        render={
          <IconButton
            aria-label='More'
            size='sm'
            variant='ghost'
            color='neutral'
            onClick={(e) => e.stopPropagation()}
          >
            <LuEllipsisVertical size={18} />
          </IconButton>
        }
      />
      <Menu.Portal>
        <Menu.Positioner align='start' sideOffset={4}>
          <Menu.Popup style={popupStyle}>
            {isConnected ? (
              <Menu.Item startDecorator={<LuUnplug size={ICON_SIZE} />} onClick={onDisconnect}>
                Disconnect
              </Menu.Item>
            ) : (
              <Menu.Item startDecorator={<LuPlug size={ICON_SIZE} />} onClick={onConnect}>
                Connect
              </Menu.Item>
            )}

            <Menu.Separator />

            <Menu.Item
              startDecorator={<LuPencil size={ICON_SIZE} />}
              onClick={() => navigate(`/account/${encodeURIComponent(connectionId)}/edit`)}
            >
              Edit
            </Menu.Item>

            <Menu.Item startDecorator={<LuStar size={ICON_SIZE} />} onClick={onToggleFavorite}>
              {isFavorite ? 'Unfavorite' : 'Favorite'}
            </Menu.Item>

            <Menu.Separator />

            <Menu.Item startDecorator={<LuCopy size={ICON_SIZE} />} onClick={onCopyId}>
              Copy Connection ID
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
};

export default ConnectionContextMenu;
