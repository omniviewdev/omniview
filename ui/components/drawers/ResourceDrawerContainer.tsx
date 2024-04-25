import { type FC } from 'react';

// Material-ui
import Drawer from '@mui/joy/Drawer';
import DialogTitle from '@mui/joy/DialogTitle';
import DialogContent from '@mui/joy/DialogContent';
import ModalClose from '@mui/joy/ModalClose';
import Sheet from '@mui/joy/Sheet';

type Props = {
  title: string;
  open: boolean;
  onClose: () => void;
  resource?: Record<string, unknown>;
  children?: React.ReactNode;
};

const ResourceDrawerContainer: FC<Props> = ({ title, open, onClose, children }) => (
  <Drawer
    disableEnforceFocus
    size='lg'
    anchor='right'
    variant='plain'
    open={open}
    onClose={() => {
      onClose();
    }}
    slotProps={{
      content: {
        sx: {
          bgcolor: 'transparent',
          p: { md: 1, sm: 0 },
          boxShadow: 'none',
        },
      },
    }}
  >
    <Sheet
      sx={{
        borderRadius: 'md',
        p: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        height: '100%',
        overflow: 'auto',
      }}
    >
      <DialogTitle>{title}</DialogTitle>
      <ModalClose />
      <DialogContent sx={{ gap: 2 }}>{children}</DialogContent>
    </Sheet>
  </Drawer>
);

export default ResourceDrawerContainer;
