import React, { useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Input,
  Stack,
  Typography,
} from '@mui/joy';
import { LuPlus, LuX } from 'react-icons/lu';

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

  return (
    <Card
      sx={{ '--Card-padding': '0px', '--Card-gap': '0px', borderRadius: 'sm', gap: '0px' }}
      variant='outlined'
    >
      <Box sx={{ py: 1, px: 1.25 }}>
        <Stack direction='row' spacing={1} alignItems='center' justifyContent='space-between'>
          <Stack direction='row' spacing={1} alignItems='center'>
            <Typography level='title-sm'>{title}</Typography>
            <Typography level='body-xs' color='neutral'>({items.length})</Typography>
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
          p: 1.5,
          backgroundColor: 'background.level1',
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
                variant='soft'
                color={chipColor}
                sx={{ borderRadius: 'sm', fontFamily: 'monospace', fontSize: 11 }}
                endDecorator={
                  !readOnly ? (
                    <LuX
                      size={12}
                      style={{ cursor: 'pointer' }}
                      onClick={() => handleRemove(i)}
                    />
                  ) : undefined
                }
              >
                {item}
              </Chip>
            ))}
            {items.length === 0 && (
              <Typography level='body-xs' color='neutral'>None</Typography>
            )}
          </Box>

          {/* Add input */}
          {!readOnly && (
            <Stack spacing={0.5}>
              <Stack direction='row' spacing={0.5}>
                <Input
                  size='sm'
                  variant='soft'
                  placeholder={placeholder}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    setError(undefined);
                  }}
                  onKeyDown={handleKeyDown}
                  error={!!error}
                  sx={{ flex: 1, fontSize: 12 }}
                />
                <Button
                  size='sm'
                  variant='soft'
                  color='primary'
                  disabled={!input.trim()}
                  onClick={handleAdd}
                  startDecorator={<LuPlus size={14} />}
                >
                  Add
                </Button>
              </Stack>
              {error && (
                <Typography level='body-xs' color='danger'>{error}</Typography>
              )}
            </Stack>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
};

export default ArrayChipEditor;
