import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { Button, IconButton } from '@omniviewdev/ui/buttons';
import { TextField } from '@omniviewdev/ui/inputs';
import { Card } from '@omniviewdev/ui';
import { LuPlus, LuTrash2 } from 'react-icons/lu';

export type Tag = {
  Key: string;
  Value: string;
};

type Props = {
  tags: Tag[];
  onChange: (tags: Tag[]) => void;
  onSave?: () => void;
  onReset?: () => void;
  dirty?: boolean;
  saving?: boolean;
  readOnly?: boolean;
  maxTags?: number;
};

const TagEditor: React.FC<Props> = ({
  tags,
  onChange,
  onSave,
  onReset,
  dirty,
  saving,
  readOnly,
  maxTags = 50,
}) => {
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const handleAdd = () => {
    const key = newKey.trim();
    if (!key) return;
    if (tags.some((t) => t.Key === key)) return;
    onChange([...tags, { Key: key, Value: newValue.trim() }]);
    setNewKey('');
    setNewValue('');
  };

  const handleRemove = (index: number) => {
    onChange(tags.filter((_, i) => i !== index));
  };

  const handleKeyChange = (index: number, value: string) => {
    const updated = [...tags];
    updated[index] = { ...updated[index], Key: value };
    onChange(updated);
  };

  const handleValueChange = (index: number, value: string) => {
    const updated = [...tags];
    updated[index] = { ...updated[index], Value: value };
    onChange(updated);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <Card
      sx={{ '--Card-padding': '0px', '--Card-gap': '0px', borderRadius: 1, gap: '0px' }}
      variant='outlined'
    >
      <Box sx={{ py: 1, px: 1.25 }}>
        <Stack direction='row' spacing={1} alignItems='center' justifyContent='space-between'>
          <Stack direction='row' spacing={1} alignItems='center'>
            <Text weight="semibold" size="sm">Tags</Text>
            <Text size="xs" color="neutral">({tags.length})</Text>
          </Stack>
          {(onSave || onReset) && (
            <Stack direction='row' spacing={0.5}>
              {onReset && (
                <Button size='sm' emphasis='ghost' color='neutral' disabled={!dirty || saving} onClick={onReset}>
                  Reset
                </Button>
              )}
              {onSave && (
                <Button size='sm' emphasis='soft' color='primary' disabled={!dirty || saving} onClick={onSave}>
                  {saving ? 'Saving...' : 'Save'}
                </Button>
              )}
            </Stack>
          )}
        </Stack>
      </Box>
      <Divider />
      <Box
        sx={{
          p: 0,
          backgroundColor: 'background.paper',
          borderBottomRightRadius: 6,
          borderBottomLeftRadius: 6,
        }}
      >
        {/* Header row */}
        <Stack
          direction='row'
          spacing={1}
          sx={{ px: 1.5, py: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}
        >
          <Text size="xs" sx={{ fontWeight: 700, flex: 1 }}>Key</Text>
          <Text size="xs" sx={{ fontWeight: 700, flex: 1 }}>Value</Text>
          {!readOnly && <Box sx={{ width: 32 }} />}
        </Stack>

        {/* Tag rows */}
        {tags.map((tag, i) => (
          <Stack
            key={i}
            direction='row'
            spacing={1}
            alignItems='center'
            sx={{
              px: 1.5,
              py: 0.25,
              '&:hover': { bgcolor: 'action.hover' },
              borderBottom: i < tags.length - 1 ? '1px solid' : undefined,
              borderColor: 'divider',
            }}
          >
            {readOnly ? (
              <>
                <Text size="xs" sx={{ flex: 1, fontFamily: 'monospace' }}>{tag.Key}</Text>
                <Text size="xs" sx={{ fontWeight: 600, flex: 1, fontFamily: 'monospace' }}>{tag.Value}</Text>
              </>
            ) : (
              <>
                <TextField
                  size='sm'
                  variant='standard'
                  value={tag.Key}
                  onChange={(value) => handleKeyChange(i, value)}
                  sx={{ flex: 1, fontSize: 12, fontFamily: 'monospace' }}
                />
                <TextField
                  size='sm'
                  variant='standard'
                  value={tag.Value}
                  onChange={(value) => handleValueChange(i, value)}
                  sx={{ flex: 1, fontSize: 12, fontFamily: 'monospace' }}
                />
                <IconButton size='sm' emphasis='ghost' color='error' onClick={() => handleRemove(i)}>
                  <LuTrash2 size={14} />
                </IconButton>
              </>
            )}
          </Stack>
        ))}

        {tags.length === 0 && (
          <Box sx={{ px: 1.5, py: 1.5 }}>
            <Text size="xs" color="neutral" sx={{ textAlign: 'center' }}>No tags</Text>
          </Box>
        )}

        {/* Add row */}
        {!readOnly && tags.length < maxTags && (
          <>
            <Divider />
            <Stack direction='row' spacing={1} alignItems='center' sx={{ px: 1.5, py: 0.5 }}>
              <TextField
                size='sm'
                placeholder='Key'
                value={newKey}
                onChange={(value) => setNewKey(value)}
                onKeyDown={handleKeyDown}
                sx={{ flex: 1, fontSize: 12 }}
              />
              <TextField
                size='sm'
                placeholder='Value'
                value={newValue}
                onChange={(value) => setNewValue(value)}
                onKeyDown={handleKeyDown}
                sx={{ flex: 1, fontSize: 12 }}
              />
              <IconButton
                size='sm'
                emphasis='soft'
                color='primary'
                disabled={!newKey.trim()}
                onClick={handleAdd}
              >
                <LuPlus size={14} />
              </IconButton>
            </Stack>
          </>
        )}
      </Box>
    </Card>
  );
};

export default TagEditor;
