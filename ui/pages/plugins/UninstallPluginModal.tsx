import * as React from 'react';

// Material-ui
import {
  Box,
  Button,
  CircularProgress,
  Modal,
  ModalDialog,
  Typography,
} from '@mui/joy';

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
      <ModalDialog
        aria-labelledby='nested-modal-title'
        aria-describedby='nested-modal-description'
        sx={theme => ({
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
        <Typography id='nested-modal-title' level='h2'>
          Are you sure you want to uninstall the {name} plugin?
        </Typography>
        <Typography id='nested-modal-description' textColor='text.tertiary'>
          This will remove all data associated with the plugin.
        </Typography>
        <Box
          sx={{
            mt: 1,
            display: 'flex',
            gap: 1,
            flexDirection: { xs: 'column', sm: 'row-reverse' },
          }}
        >
          <Button
            variant='solid'
            color='primary'
            onClick={handleUninstall}
            disabled={uninstalling}
          >
            {uninstalling ? <CircularProgress /> : 'Uninstall'}
          </Button>
          <Button
            variant='outlined'
            color='neutral'
            onClick={onClose}
            disabled={uninstalling}
          >
            Cancel
          </Button>
        </Box>
      </ModalDialog>
    </Modal>
  );
};

export default UninstallPluginModal;
