import React from 'react';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import { Modal } from '@omniviewdev/ui/overlays';
import { Button } from '@omniviewdev/ui/buttons';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { LuTriangleAlert } from 'react-icons/lu';

type Props = {
  open: boolean;
  connectionName: string;
  onConfirm: () => void;
  onCancel: () => void;
};

const DeleteConfirmationModal: React.FC<Props> = ({ open, connectionName, onConfirm, onCancel }) => (
  <Modal open={open} onClose={onCancel}>
    <Box sx={{ p: 2, minWidth: 360 }}>
      <Stack direction='row' alignItems='center' gap={1} sx={{ mb: 1 }}>
        <LuTriangleAlert size={20} />
        <Text weight='semibold'>Delete Connection</Text>
      </Stack>
      <Divider />
      <Box sx={{ py: 2 }}>
        <Text>
          Are you sure you want to delete <strong>{connectionName}</strong>? This action cannot be undone.
        </Text>
      </Box>
      <Stack direction='row' justifyContent='flex-end' gap={1}>
        <Button emphasis='solid' color='danger' onClick={onConfirm}>
          Delete
        </Button>
        <Button emphasis='ghost' color='neutral' onClick={onCancel}>
          Cancel
        </Button>
      </Stack>
    </Box>
  </Modal>
);

export default DeleteConfirmationModal;
