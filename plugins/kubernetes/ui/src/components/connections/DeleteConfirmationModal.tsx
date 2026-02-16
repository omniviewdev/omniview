import React from 'react';
import {
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Modal,
  ModalDialog,
  Typography,
} from '@mui/joy';
import { LuTriangleAlert } from 'react-icons/lu';

type Props = {
  open: boolean;
  connectionName: string;
  onConfirm: () => void;
  onCancel: () => void;
};

const DeleteConfirmationModal: React.FC<Props> = ({ open, connectionName, onConfirm, onCancel }) => (
  <Modal open={open} onClose={onCancel}>
    <ModalDialog variant='outlined' role='alertdialog' size='sm'>
      <DialogTitle>
        <LuTriangleAlert size={20} />
        Delete Connection
      </DialogTitle>
      <Divider />
      <DialogContent>
        <Typography level='body-md'>
          Are you sure you want to delete <strong>{connectionName}</strong>? This action cannot be undone.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button variant='solid' color='danger' onClick={onConfirm}>
          Delete
        </Button>
        <Button variant='plain' color='neutral' onClick={onCancel}>
          Cancel
        </Button>
      </DialogActions>
    </ModalDialog>
  </Modal>
);

export default DeleteConfirmationModal;
