import * as React from 'react';

// material ui
import { Alert } from '@omniviewdev/ui/feedback';
import Box from '@mui/material/Box';
import { Button } from '@omniviewdev/ui/buttons';
import Divider from '@mui/material/Divider';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import { IconButton } from '@omniviewdev/ui/buttons';
import { ListItem } from '@omniviewdev/ui';
import { Modal } from '@omniviewdev/ui/overlays';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import CircularProgress from '@mui/material/CircularProgress';

// icons
import WarningRoundedIcon from '@mui/icons-material/WarningRounded';
import { LuCircleAlert, LuTrash } from 'react-icons/lu';
import { useResource } from '@omniviewdev/runtime';

type Props = {
  plugin: string;
  connection: string;
  resource: string;
  namespace: string;
  id: string;
  handleSelect: () => void;
  handleDeselect: () => void;
  handleDismiss: () => void;
};

export const DeleteAction: React.FC<Props> = ({ id, resource, plugin, connection, namespace, handleSelect, handleDeselect, handleDismiss }) => {
  const [open, setOpen] = React.useState<boolean>(false);
  const [pending, setPending] = React.useState<boolean>(false);
  const [alert, setAlert] = React.useState<string>('');

  const { remove } = useResource({ pluginID: plugin, connectionID: connection, resourceKey: resource, resourceID: id, namespace });

  return (
    <React.Fragment>
      <ListItem>
        <IconButton
          emphasis='ghost'
          color='neutral'
          onMouseEnter={handleSelect}
          onMouseLeave={handleDeselect}
          onClick={() => {
            setOpen(true);
          }}
          sx={{
            display: 'flex',
            borderRadius: '2px',
            flex: 1,
            width: '100%',
            bgcolor: open ? 'neutral.plainHoverBg' : undefined,
            '&:focus-visible': {
              bgcolor: 'neutral.plainHoverBg',
            },
          }}
        >
          <Stack
            direction='row'
            spacing={1}
            flex={1}
            px={1}
            alignItems={'center'}
            justifyContent='flex-start'
          >
            <LuTrash />
            <Text sx={{ pl: 0.5 }} size='sm'>Delete</Text>
          </Stack>
        </IconButton>
      </ListItem>
      <Modal open={open} onClose={() => {
        setOpen(false);
      }}>
        <Box role="alertdialog" sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2, bgcolor: 'background.paper' }}>
          <DialogTitle>
            <WarningRoundedIcon />
            Confirmation
          </DialogTitle>
          <Divider />
          <DialogContent sx={{ gap: 2 }}>
            <Text size='sm'>
              Are you sure you want to delete {resource} '{id}'?
            </Text>
            {alert && <Box sx={{ display: 'flex', gap: 2, width: '100%', flexDirection: 'column' }}>
              <Alert
                sx={{ alignItems: 'flex-start' }}
                icon={<LuCircleAlert />}
                emphasis="soft"
                severity='error'
              >
                <div>
                  <div>Error</div>
                  <Text size="sm" color='danger'>
                    {alert}
                  </Text>
                </div>
              </Alert>
            </Box>
            }
          </DialogContent>
          <DialogActions>
            <Button emphasis="solid" color="danger" onClick={() => {
              setPending(true);
              remove({}).then(() => {
                setOpen(false);
                handleDismiss();
              }).catch((e) => {
                if (e instanceof Error) {
                  setAlert(e.message);
                }
              }).finally(() => {
                setPending(false);
              });
            }}>
              {pending ? <CircularProgress size={20} /> : 'Delete'}
            </Button>
            <Button emphasis="ghost" color="neutral" onClick={() => {
              setOpen(false);
              handleDismiss();
            }}>
              Cancel
            </Button>
          </DialogActions>
        </Box>
      </Modal>
    </React.Fragment>
  );
};

export default DeleteAction;
