import * as React from 'react';

import { Button, Dialog, Spinner, Text } from '@omniviewdev/base-ui';

type Props = {
  open: boolean;
  onClose: () => void;
  name: string;
  uninstall: () => void;
  devMode?: boolean;
};

const UninstallPluginModal: React.FC<Props> = ({ open, name, uninstall, onClose, devMode }) => {
  const [uninstalling, setUninstalling] = React.useState(false);

  const handleUninstall = () => {
    setUninstalling(true);
    uninstall();
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} size='sm'>
      <Dialog.Title>
        Uninstall {name}?
      </Dialog.Title>
      <Dialog.Body>
        <Text size='sm' tone='muted'>
          {devMode
            ? 'This will stop the dev server and remove the plugin metadata.'
            : 'This will remove the plugin and all associated data.'}
        </Text>
      </Dialog.Body>
      <Dialog.Footer>
        <Button
          variant='outline'
          color='neutral'
          size='sm'
          onClick={onClose}
          disabled={uninstalling}
        >
          Cancel
        </Button>
        <Button
          variant='solid'
          color='danger'
          size='sm'
          onClick={handleUninstall}
          disabled={uninstalling}
        >
          {uninstalling ? <Spinner size='sm' /> : 'Uninstall'}
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
};

export default UninstallPluginModal;
