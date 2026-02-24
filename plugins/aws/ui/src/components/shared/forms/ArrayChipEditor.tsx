import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { Button } from '@omniviewdev/ui/buttons';
import { TextField } from '@omniviewdev/ui/inputs';
import { Card, Chip } from '@omniviewdev/ui';
import { LuPlus } from 'react-icons/lu';

type Props = {
  title: string;
  items: string[];
  onChange: (items: string[]) => void;
  onSave?: () => void;
  onReset?: () => void;
  dirty?: boolean;
  saving?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  /** Validate input before adding. Return error string or undefined if valid. */
  validate?: (value: string) => string | undefined;
  chipColor?: 'primary' | 'neutral' | 'success' | 'warning' | 'danger';
};

const ArrayChipEditor: React.FC<Props> = ({
  title,
  items,
  onChange,
  onSave,
  onReset,
  dirty,
  saving,
  readOnly,
  placeholder = 'Add item...',
  validate,
  chipColor = 'neutral',
}) => {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string>();

  const handleAdd = () => {
    const value = input.trim();
    if (!value) return;
    if (items.includes(value)) {
      setError('Already exists');
      return;
    }
    if (validate) {
      const err = validate(value);
      if (err) {
        setError(err);
        return;
      }
    }
    onChange([...items, value]);
    setInput('');
    setError(undefined);
  };

  const handleRemove = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  const muiChipColor = chipColor === 'neutral' ? 'default' : chipColor === 'danger' ? 'error' : chipColor;

  return (
    <Card
      sx={{ '--Card-padding': '0px', '--Card-gap': '0px', borderRadius: 1, gap: '0px' }}
      variant='outlined'
    >
      <Box sx={{ py: 1, px: 1.25 }}>
        <Stack direction='row' spacing={1} alignItems='center' justifyContent='space-between'>
          <Stack direction='row' spacing={1} alignItems='center'>
            <Text weight="semibold" size="sm">{title}</Text>
            <Text size="xs" color="neutral">({items.length})</Text>
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
          p: 1.5,
          backgroundColor: 'background.paper',
          borderBottomRightRadius: 6,
          borderBottomLeftRadius: 6,
        }}
      >
        <Stack spacing={1}>
          {/* Chips */}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {items.map((item, i) => (
              <Chip
                key={i}
                size='sm'
                label={item}
                color={muiChipColor}
                variant='filled'
                sx={{ borderRadius: 1, fontFamily: 'monospace', fontSize: 11 }}
                onDelete={
                  !readOnly ? () => handleRemove(i) : undefined
                }
              />
            ))}
            {items.length === 0 && (
              <Text size="xs" color="neutral">None</Text>
            )}
          </Box>

          {/* Add input */}
          {!readOnly && (
            <Stack spacing={0.5}>
              <Stack direction='row' spacing={0.5}>
                <TextField
                  size='sm'
                  placeholder={placeholder}
                  value={input}
                  onChange={(value) => {
                    setInput(value);
                    setError(undefined);
                  }}
                  onKeyDown={handleKeyDown}
                  error={!!error}
                  sx={{ flex: 1, fontSize: 12 }}
                />
                <Button
                  size='sm'
                  emphasis='soft'
                  color='primary'
                  disabled={!input.trim()}
                  onClick={handleAdd}
                  startAdornment={<LuPlus size={14} />}
                >
                  Add
                </Button>
              </Stack>
              {error && (
                <Text size="xs" color="error">{error}</Text>
              )}
            </Stack>
          )}
        </Stack>
      </Box>
    </Card>
  );
};

export default ArrayChipEditor;
