import React, { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import { Button, IconButton } from '@omniviewdev/ui/buttons';
import { TextField, FormField } from '@omniviewdev/ui/inputs';
import { Modal } from '@omniviewdev/ui/overlays';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
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
      <Box sx={{ minWidth: 360, p: 1.5 }}>
        <form onSubmit={handleSubmit}>
          <Text weight='semibold' size='lg' sx={{ mb: 1 }}>
            {mode === 'create' ? 'New Folder' : 'Edit Folder'}
          </Text>
          <Divider />
          <Stack gap={1.5} sx={{ pt: 1.5 }}>
            <FormField label='Name' error={isDuplicate ? 'A folder with this name already exists' : undefined}>
              <TextField
                autoFocus
                size='sm'
                placeholder='e.g. Production Suite'
                value={name}
                onChange={e => setName(e)}
              />
            </FormField>

            <Stack gap={0.75}>
              <Text weight='semibold' size='sm'>Color</Text>
              <Stack direction='row' gap={0.75} flexWrap='wrap'>
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

            <Stack gap={0.75}>
              <Text weight='semibold' size='sm'>Icon</Text>
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
                      emphasis={icon === key ? 'soft' : 'ghost'}
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
          </Stack>
          <Stack direction='row' justifyContent='flex-end' gap={1} sx={{ mt: 1.5 }}>
            {mode === 'edit' && onDelete && (
              <Button
                emphasis='ghost'
                color='danger'
                onClick={onDelete}
                sx={{ mr: 'auto' }}
              >
                Delete
              </Button>
            )}
            <Button emphasis='ghost' color='neutral' onClick={onClose}>
              Cancel
            </Button>
            <Button type='submit' emphasis='solid' color='primary' disabled={!canSubmit}>
              {mode === 'create' ? 'Create' : 'Save'}
            </Button>
          </Stack>
        </form>
      </Box>
    </Modal>
  );
};

export default FolderDialog;
