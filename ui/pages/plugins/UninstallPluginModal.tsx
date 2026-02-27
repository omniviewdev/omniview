import * as React from 'react';

// Material-ui
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { Button } from '@omniviewdev/ui/buttons';
import { Modal } from '@omniviewdev/ui/overlays';
import { Text } from '@omniviewdev/ui/typography';

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
    <Modal open={open} onClose={onClose} size="sm" sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Text weight="semibold" size="lg">
        Uninstall {name}?
      </Text>
      <Text size="sm" sx={{ color: 'text.tertiary' }}>
        {devMode
          ? 'This will stop the dev server and remove the plugin metadata.'
          : 'This will remove the plugin and all associated data.'}
      </Text>
      <Box
        sx={{
          mt: 2,
          display: 'flex',
          gap: 1,
          justifyContent: 'flex-end',
        }}
      >
        <Button
          emphasis='outline'
          color='neutral'
          size='sm'
          onClick={onClose}
          disabled={uninstalling}
        >
          Cancel
        </Button>
        <Button
          emphasis='solid'
          color='danger'
          size='sm'
          onClick={handleUninstall}
          disabled={uninstalling}
        >
          {uninstalling ? <CircularProgress size={16} /> : 'Uninstall'}
        </Button>
      </Box>
    </Modal>
  );
};

export default UninstallPluginModal;
