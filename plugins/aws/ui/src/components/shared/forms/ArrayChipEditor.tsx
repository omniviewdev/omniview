import React, { useState } from 'react';
import { Button, Stack, Text } from '@omniviewdev/base-ui';
import SectionCard from '../ui/SectionCard';
import TextInput from '../ui/TextInput';
import RemovableChip from '../ui/RemovableChip';
import { toColor } from '../ui/colors';
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


  return (
    <SectionCard
      title={
        <Stack direction='row' spacing={2} align='center'>
          <Text weight="semibold" size="sm">{title}</Text>
          <Text size="xs" tone="muted">({items.length})</Text>
        </Stack>
      }
      actions={(onSave || onReset) ? (
        <>
          {onReset && (
            <Button size='sm' variant='ghost' color='neutral' disabled={!dirty || saving} onClick={onReset}>
              Reset
            </Button>
          )}
          {onSave && (
            <Button size='sm' variant='soft' color='brand' disabled={!dirty || saving} onClick={onSave}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          )}
        </>
      ) : undefined}
      bodyPadding={12}
    >
      <Stack spacing={2}>
        {/* Chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {items.map((item, i) => (
            <RemovableChip
              key={i}
              color={toColor(chipColor)}
              variant='solid'
              mono
              style={{ fontSize: 11 }}
              onRemove={!readOnly ? () => handleRemove(i) : undefined}
            >
              {item}
            </RemovableChip>
          ))}
          {items.length === 0 && (
            <Text size="xs" tone="muted">None</Text>
          )}
        </div>

        {/* Add input */}
        {!readOnly && (
          <Stack spacing={1}>
            <Stack direction='row' spacing={1}>
              <TextInput
                size='sm'
                placeholder={placeholder}
                value={input}
                onChange={(value) => {
                  setInput(value);
                  setError(undefined);
                }}
                onKeyDown={handleKeyDown}
                error={!!error}
                style={{ flex: 1 }}
              />
              <Button
                size='sm'
                variant='soft'
                color='brand'
                disabled={!input.trim()}
                onClick={handleAdd}
                startDecorator={<LuPlus size={14} />}
              >
                Add
              </Button>
            </Stack>
            {error && (
              <Text size="xs" tone="danger">{error}</Text>
            )}
          </Stack>
        )}
      </Stack>
    </SectionCard>
  );
};

export default ArrayChipEditor;
