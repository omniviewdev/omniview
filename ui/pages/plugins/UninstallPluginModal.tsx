import * as React from 'react';

// Material-ui
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { Button } from '@omniviewdev/ui/buttons';
import { Modal } from '@omniviewdev/ui/overlays';
import { Text, Heading } from '@omniviewdev/ui/typography';

type Props = {
  open: boolean;
  onClose: () => void;
  name: string;
  uninstall: () => void;
};

const UninstallPluginModal: React.FC<Props> = ({ open, name, uninstall, onClose }) => {
  const [uninstalling, setUninstalling] = React.useState(false);

  const handleUninstall = () => {
    setUninstalling(true);
    uninstall();
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose}>
      <Box
        sx={theme => ({
          p: 3,
          [theme.breakpoints.only('xs')]: {
            top: 'unset',
            bottom: 0,
            left: 0,
            right: 0,
            borderRadius: 0,
            transform: 'none',
            maxWidth: 'unset',
          },
        })}
      >
        <Heading level={2}>
          Are you sure you want to uninstall the {name} plugin?
        </Heading>
        <Text sx={{ color: 'text.tertiary' }}>
          This will remove all data associated with the plugin.
        </Text>
        <Box
          sx={{
            mt: 1,
            display: 'flex',
            gap: 1,
            flexDirection: { xs: 'column', sm: 'row-reverse' },
          }}
        >
          <Button
            emphasis='solid'
            color='primary'
            onClick={handleUninstall}
            disabled={uninstalling}
          >
            {uninstalling ? <CircularProgress size={20} /> : 'Uninstall'}
          </Button>
          <Button
            emphasis='outline'
            color='neutral'
            onClick={onClose}
            disabled={uninstalling}
          >
            Cancel
          </Button>
        </Box>
      </Box>
    </Modal>
  );
};

export default UninstallPluginModal;
