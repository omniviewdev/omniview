import * as React from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { Modal } from '@omniviewdev/ui/overlays';
import { Text } from '@omniviewdev/ui/typography';

type Props = {
  ref?: React.RefObject<HTMLDivElement>;
  open: boolean;
  message: string;
};

export default function PluginBackdrop({ ref, open, message }: Props): React.ReactElement {
  console.log('PluginBackdrop', open, message);

  return (
    <Modal
      open={open}
      onClose={() => {}}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          p: 3,
        }}
      >
        <CircularProgress size={40} thickness={6} />
        <Text size='sm'>{message}</Text>
      </Box>
    </Modal>
  );
}
