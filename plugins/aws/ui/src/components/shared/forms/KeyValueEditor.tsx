import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { Button, IconButton } from '@omniviewdev/ui/buttons';
import { TextField } from '@omniviewdev/ui/inputs';
import { Card } from '@omniviewdev/ui';
import { LuPlus, LuTrash2 } from 'react-icons/lu';

type Props = {
  title: string;
  entries: Record<string, string>;
  onChange: (entries: Record<string, string>) => void;
  onSave?: () => void;
  onReset?: () => void;
  dirty?: boolean;
  saving?: boolean;
  readOnly?: boolean;
  keyLabel?: string;
  valueLabel?: string;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  /** If true, keys cannot be edited (only values) */
  fixedKeys?: boolean;
};

const KeyValueEditor: React.FC<Props> = ({
  title,
  entries,
  onChange,
  onSave,
  onReset,
  dirty,
  saving,
  readOnly,
  keyLabel = 'Key',
  valueLabel = 'Value',
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  fixedKeys,
}) => {
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const pairs = Object.entries(entries);

  const handleAdd = () => {
    const key = newKey.trim();
    if (!key || key in entries) return;
    onChange({ ...entries, [key]: newValue.trim() });
    setNewKey('');
    setNewValue('');
  };

  const handleRemove = (key: string) => {
    const updated = { ...entries };
    delete updated[key];
    onChange(updated);
  };

  const handleValueChange = (key: string, value: string) => {
    onChange({ ...entries, [key]: value });
  };

  const handleKeyRename = (oldKey: string, newKeyName: string) => {
    if (fixedKeys) return;
    const updated: Record<string, string> = {};
    for (const [k, v] of Object.entries(entries)) {
      updated[k === oldKey ? newKeyName : k] = v;
    }
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
            <Text weight="semibold" size="sm">{title}</Text>
            <Text size="xs" color="neutral">({pairs.length})</Text>
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
        {/* Header */}
        <Stack direction='row' spacing={1} sx={{ px: 1.5, py: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Text size="xs" sx={{ fontWeight: 700, flex: 1 }}>{keyLabel}</Text>
          <Text size="xs" sx={{ fontWeight: 700, flex: 1 }}>{valueLabel}</Text>
          {!readOnly && <Box sx={{ width: 32 }} />}
        </Stack>

        {/* Rows */}
        {pairs.map(([key, value], i) => (
          <Stack
            key={key}
            direction='row'
            spacing={1}
            alignItems='center'
            sx={{
              px: 1.5,
              py: 0.25,
              '&:hover': { bgcolor: 'action.hover' },
              borderBottom: i < pairs.length - 1 ? '1px solid' : undefined,
              borderColor: 'divider',
            }}
          >
            {readOnly || fixedKeys ? (
              <Text size="xs" sx={{ flex: 1, fontFamily: 'monospace' }}>{key}</Text>
            ) : (
              <TextField
                size='sm'
                variant='standard'
                value={key}
                onChange={(value) => handleKeyRename(key, value)}
                sx={{ flex: 1, fontSize: 12, fontFamily: 'monospace' }}
              />
            )}
            {readOnly ? (
              <Text size="xs" sx={{ fontWeight: 600, flex: 1, fontFamily: 'monospace' }}>{value}</Text>
            ) : (
              <TextField
                size='sm'
                variant='standard'
                value={value}
                onChange={(value) => handleValueChange(key, value)}
                sx={{ flex: 1, fontSize: 12, fontFamily: 'monospace' }}
              />
            )}
            {!readOnly && (
              <IconButton size='sm' emphasis='ghost' color='error' onClick={() => handleRemove(key)}>
                <LuTrash2 size={14} />
              </IconButton>
            )}
          </Stack>
        ))}

        {pairs.length === 0 && (
          <Box sx={{ px: 1.5, py: 1.5 }}>
            <Text size="xs" color="neutral" sx={{ textAlign: 'center' }}>No entries</Text>
          </Box>
        )}

        {/* Add row */}
        {!readOnly && (
          <>
            <Divider />
            <Stack direction='row' spacing={1} alignItems='center' sx={{ px: 1.5, py: 0.5 }}>
              <TextField
                size='sm'
                placeholder={keyPlaceholder}
                value={newKey}
                onChange={(value) => setNewKey(value)}
                onKeyDown={handleKeyDown}
                sx={{ flex: 1, fontSize: 12 }}
              />
              <TextField
                size='sm'
                placeholder={valuePlaceholder}
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

export default KeyValueEditor;
