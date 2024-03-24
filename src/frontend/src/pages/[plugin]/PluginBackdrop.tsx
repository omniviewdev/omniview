import * as React from 'react';
import { Transition } from 'react-transition-group';
import Modal from '@mui/joy/Modal';
import ModalDialog from '@mui/joy/ModalDialog';
import DialogContent from '@mui/joy/DialogContent';
import { CircularProgress, Typography } from '@mui/joy';

type Props = {
  ref?: React.RefObject<HTMLDivElement>;
  open: boolean;
  message: string;
};

export default function PluginBackdrop({ ref, open, message }: Props): React.ReactElement {
  return (
    <Transition in={open} timeout={400}>
      {(state: string) => (
        <Modal
          container={ref?.current}
          keepMounted
          open={open}
          slotProps={{
            backdrop: {
              sx: {
                opacity: 0,
                backdropFilter: 'none',
                transition: 'opacity 400ms, backdrop-filter 400ms',
                ...{
                  entering: { opacity: 1, backdropFilter: 'blur(8px)' },
                  entered: { opacity: 1, backdropFilter: 'blur(8px)' },
                }[state],
              },
            },
          }}
          sx={{
            visibility: state === 'exited' ? 'hidden' : 'visible',
          }}
        >
          <ModalDialog
            sx={{
              opacity: 0,
              transition: 'opacity 300ms',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              ...{
                entering: { opacity: 1 },
                entered: { opacity: 1 },
              }[state],
            }}
          >
            <DialogContent sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
            }}>
              <CircularProgress size={'md'} thickness={6} />
              <Typography level='body-sm'>{message}</Typography>
            </DialogContent>
          </ModalDialog>
        </Modal>
      )}
    </Transition>
  );
}
