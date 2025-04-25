import * as React from 'react';

// material ui
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  ListItem,
  ListItemButton,
  Modal,
  ModalDialog,
  Stack,
  Typography,
} from '@mui/joy';
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
        <ListItemButton
          slots={{ root: IconButton }}
          slotProps={{ root: { variant: 'plain', color: 'neutral', width: '100%' } }}
          onMouseEnter={handleSelect}
          onMouseLeave={handleDeselect}
          onClick={() => {
            setOpen(true);
          }}
          sx={{
            display: 'flex',
            borderRadius: '2px',
            flex: 1,
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
            <Typography sx={{ pl: 0.5 }} level='body-sm'>Delete</Typography>
          </Stack>
        </ListItemButton>
      </ListItem>
      <Modal open={open} onClose={() => {
        setOpen(false);
      }}>
        <ModalDialog variant="outlined" role="alertdialog">
          <DialogTitle>
            <WarningRoundedIcon />
            Confirmation
          </DialogTitle>
          <Divider />
          <DialogContent sx={{ gap: 2 }}>
            <Typography level='body-sm'>
              Are you sure you want to delete {resource} '{id}'?
            </Typography>
            {alert && <Box sx={{ display: 'flex', gap: 2, width: '100%', flexDirection: 'column' }}>
              <Alert
                sx={{ alignItems: 'flex-start' }}
                startDecorator={<LuCircleAlert />}
                variant="soft"
                color={'danger'}
              >
                <div>
                  <div>Error</div>
                  <Typography level="body-sm" color={'danger'}>
                    {alert}
                  </Typography>
                </div>
              </Alert>
            </Box>
            }
          </DialogContent>
          <DialogActions>
            <Button variant="solid" color="danger" onClick={() => {
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
              {pending ? <CircularProgress size='sm' /> : 'Delete'}
            </Button>
            <Button variant="plain" color="neutral" onClick={() => {
              setOpen(false);
              handleDismiss();
            }}>
              Cancel
            </Button>
          </DialogActions>
        </ModalDialog>
      </Modal>
    </React.Fragment>
  );
};

export default DeleteAction;
