import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormHelperText,
  IconButton,
  Input,
  Modal,
  ModalDialog,
  Stack,
  Typography,
} from '@mui/joy';
import { FOLDER_ICON_MAP, PRESET_COLORS, getFolderIcon } from '../../utils/folderIcons';

export interface FolderDialogValues {
  name: string;
  color: string;
  icon: string;
}

type Props = {
  open: boolean;
  mode: 'create' | 'edit';
  initial?: Partial<FolderDialogValues>;
  existingNames?: string[];
  onSubmit: (values: FolderDialogValues) => void;
  onDelete?: () => void;
  onClose: () => void;
};

const iconKeys = Object.keys(FOLDER_ICON_MAP);

const FolderDialog: React.FC<Props> = ({
  open,
  mode,
  initial,
  existingNames = [],
  onSubmit,
  onDelete,
  onClose,
}) => {
  const [name, setName] = useState(initial?.name ?? '');
  const [color, setColor] = useState(initial?.color ?? PRESET_COLORS[0]);
  const [icon, setIcon] = useState(initial?.icon ?? 'LuFolder');

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? '');
      setColor(initial?.color ?? PRESET_COLORS[0]);
      setIcon(initial?.icon ?? 'LuFolder');
    }
  }, [open, initial]);

  const trimmed = name.trim();
  const isDuplicate = trimmed.length > 0
    && existingNames.some(n => n.toLowerCase() === trimmed.toLowerCase())
    && trimmed.toLowerCase() !== (initial?.name ?? '').toLowerCase();
  const canSubmit = trimmed.length > 0 && !isDuplicate;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({ name: trimmed, color, icon });
  };

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog variant='outlined' size='sm' sx={{ minWidth: 380, maxWidth: 420 }}>
        <form onSubmit={handleSubmit}>
          <DialogTitle sx={{ fontSize: 'lg', pb: 1.5 }}>
            {mode === 'create' ? 'New Folder' : 'Edit Folder'}
          </DialogTitle>
          <Divider />
          <DialogContent sx={{ gap: 2.5, pt: 1.5 }}>
            <FormControl error={isDuplicate}>
              <Typography level='body-sm' fontWeight={600} sx={{ mb: 0.5 }}>Name</Typography>
              <Input
                autoFocus
                size='sm'
                placeholder='e.g. Production Suite'
                value={name}
                onChange={e => setName(e.target.value)}
              />
              {isDuplicate && (
                <FormHelperText>A folder with this name already exists</FormHelperText>
              )}
            </FormControl>

            <Stack gap={1}>
              <Typography level='body-sm' fontWeight={600}>Color</Typography>
              <Stack direction='row' gap={1} flexWrap='wrap' sx={{ p: 0.5 }}>
                {PRESET_COLORS.map(c => (
                  <Box
                    key={c}
                    onClick={() => setColor(c)}
                    sx={{
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      backgroundColor: c,
                      cursor: 'pointer',
                      outline: color === c ? `2px solid ${c}` : '2px solid transparent',
                      outlineOffset: 2,
                      transition: 'outline-color 0.1s',
                      '&:hover': { opacity: 0.8 },
                    }}
                  />
                ))}
              </Stack>
            </Stack>

            <Stack gap={1}>
              <Typography level='body-sm' fontWeight={600}>Icon</Typography>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(9, 1fr)',
                  gap: 0.5,
                }}
              >
                {iconKeys.map(key => {
                  const Icon = getFolderIcon(key);
                  return (
                    <IconButton
                      key={key}
                      size='sm'
                      variant={icon === key ? 'soft' : 'plain'}
                      color={icon === key ? 'primary' : 'neutral'}
                      onClick={() => setIcon(key)}
                      sx={{ aspectRatio: 1 }}
                    >
                      <Icon size={16} />
                    </IconButton>
                  );
                })}
              </Box>
            </Stack>
          </DialogContent>
          <DialogActions>
            {mode === 'edit' && onDelete && (
              <Button
                variant='plain'
                color='danger'
                onClick={onDelete}
                sx={{ mr: 'auto' }}
              >
                Delete
              </Button>
            )}
            <Button type='submit' variant='solid' color='primary' disabled={!canSubmit}>
              {mode === 'create' ? 'Create' : 'Save'}
            </Button>
            <Button variant='plain' color='neutral' onClick={onClose}>
              Cancel
            </Button>
          </DialogActions>
        </form>
      </ModalDialog>
    </Modal>
  );
};

export default FolderDialog;
