import * as React from 'react';

// @omniviewdev/ui
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import { Alert } from '@omniviewdev/ui/feedback';
import { Modal } from '@omniviewdev/ui/overlays';
import { Button } from '@omniviewdev/ui/buttons';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';

// icons
import { WarningRounded } from '@mui/icons-material';
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
      <Box
        component='li'
        sx={{ listStyle: 'none' }}
      >
        <Box
          component='button'
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
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            bgcolor: open ? 'action.hover' : undefined,
            '&:focus-visible': {
              bgcolor: 'action.hover',
            },
            p: 0,
          }}
        >
          <Stack
            direction='row'
            gap={1}
            sx={{ flex: 1, px: 1, alignItems: 'center', justifyContent: 'flex-start' }}
          >
            <LuTrash />
            <Text sx={{ pl: 0.5 }} size='sm'>Delete</Text>
          </Stack>
        </Box>
      </Box>
      <Modal open={open} onClose={() => {
        setOpen(false);
      }}>
        <Box sx={{ p: 2, minWidth: 360 }}>
          <Stack direction='row' alignItems='center' gap={1} sx={{ mb: 1 }}>
            <WarningRounded />
            <Text weight='semibold'>Confirmation</Text>
          </Stack>
          <Divider />
          <Box sx={{ py: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Text size='sm'>
              Are you sure you want to delete {resource} '{id}'?
            </Text>
            {alert && <Box sx={{ display: 'flex', gap: 2, width: '100%', flexDirection: 'column' }}>
              <Alert
                sx={{ alignItems: 'flex-start' }}
                startAdornment={<LuCircleAlert />}
                emphasis="soft"
                color='danger'
              >
                <div>
                  <div>Error</div>
                  <Text size='sm' sx={{ color: 'danger.main' }}>
                    {alert}
                  </Text>
                </div>
              </Alert>
            </Box>
            }
          </Box>
          <Stack direction='row' justifyContent='flex-end' gap={1}>
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
              {pending ? <CircularProgress size={16} /> : 'Delete'}
            </Button>
            <Button emphasis="ghost" color="neutral" onClick={() => {
              setOpen(false);
              handleDismiss();
            }}>
              Cancel
            </Button>
          </Stack>
        </Box>
      </Modal>
    </React.Fragment>
  );
};

export default DeleteAction;
