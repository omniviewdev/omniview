import React, { useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  IconButton,
  Input,
  Stack,
  Typography,
} from '@mui/joy';
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
      sx={{ '--Card-padding': '0px', '--Card-gap': '0px', borderRadius: 'sm', gap: '0px' }}
      variant='outlined'
    >
      <Box sx={{ py: 1, px: 1.25 }}>
        <Stack direction='row' spacing={1} alignItems='center' justifyContent='space-between'>
          <Stack direction='row' spacing={1} alignItems='center'>
            <Typography level='title-sm'>{title}</Typography>
            <Typography level='body-xs' color='neutral'>({pairs.length})</Typography>
          </Stack>
          {(onSave || onReset) && (
            <Stack direction='row' spacing={0.5}>
              {onReset && (
                <Button size='sm' variant='plain' color='neutral' disabled={!dirty || saving} onClick={onReset}>
                  Reset
                </Button>
              )}
              {onSave && (
                <Button size='sm' variant='soft' color='primary' disabled={!dirty || saving} loading={saving} onClick={onSave}>
                  Save
                </Button>
              )}
            </Stack>
          )}
        </Stack>
      </Box>
      <Divider />
      <CardContent
        sx={{
          p: 0,
          backgroundColor: 'background.level1',
          borderBottomRightRadius: 6,
          borderBottomLeftRadius: 6,
        }}
      >
        {/* Header */}
        <Stack direction='row' spacing={1} sx={{ px: 1.5, py: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography level='body-xs' fontWeight={700} sx={{ flex: 1 }}>{keyLabel}</Typography>
          <Typography level='body-xs' fontWeight={700} sx={{ flex: 1 }}>{valueLabel}</Typography>
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
              '&:hover': { bgcolor: 'background.level2' },
              borderBottom: i < pairs.length - 1 ? '1px solid' : undefined,
              borderColor: 'divider',
            }}
          >
            {readOnly || fixedKeys ? (
              <Typography level='body-xs' sx={{ flex: 1, fontFamily: 'monospace' }}>{key}</Typography>
            ) : (
              <Input
                size='sm'
                variant='plain'
                value={key}
                onChange={(e) => handleKeyRename(key, e.target.value)}
                sx={{ flex: 1, fontSize: 12, fontFamily: 'monospace', '--Input-focusedHighlight': 'transparent' }}
              />
            )}
            {readOnly ? (
              <Typography level='body-xs' fontWeight={600} sx={{ flex: 1, fontFamily: 'monospace' }}>{value}</Typography>
            ) : (
              <Input
                size='sm'
                variant='plain'
                value={value}
                onChange={(e) => handleValueChange(key, e.target.value)}
                sx={{ flex: 1, fontSize: 12, fontFamily: 'monospace', '--Input-focusedHighlight': 'transparent' }}
              />
            )}
            {!readOnly && (
              <IconButton size='sm' variant='plain' color='danger' onClick={() => handleRemove(key)}>
                <LuTrash2 size={14} />
              </IconButton>
            )}
          </Stack>
        ))}

        {pairs.length === 0 && (
          <Box sx={{ px: 1.5, py: 1.5 }}>
            <Typography level='body-xs' color='neutral' textAlign='center'>No entries</Typography>
          </Box>
        )}

        {/* Add row */}
        {!readOnly && (
          <>
            <Divider />
            <Stack direction='row' spacing={1} alignItems='center' sx={{ px: 1.5, py: 0.5 }}>
              <Input
                size='sm'
                variant='soft'
                placeholder={keyPlaceholder}
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                onKeyDown={handleKeyDown}
                sx={{ flex: 1, fontSize: 12 }}
              />
              <Input
                size='sm'
                variant='soft'
                placeholder={valuePlaceholder}
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                onKeyDown={handleKeyDown}
                sx={{ flex: 1, fontSize: 12 }}
              />
              <IconButton
                size='sm'
                variant='soft'
                color='primary'
                disabled={!newKey.trim()}
                onClick={handleAdd}
              >
                <LuPlus size={14} />
              </IconButton>
            </Stack>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default KeyValueEditor;
