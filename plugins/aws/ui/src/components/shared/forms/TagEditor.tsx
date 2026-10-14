import React, { useState } from 'react';
import { Button, IconButton, Separator, Stack, Text } from '@omniviewdev/base-ui';
import SectionCard from '../ui/SectionCard';
import TextInput from '../ui/TextInput';
import styles from './EditorRows.module.css';
import { LuPlus, LuTrash2 } from 'react-icons/lu';

export type Tag = {
  Key: string;
  Value: string;
};

const flex1: React.CSSProperties = { flex: 1 };
const boldFlex: React.CSSProperties = { fontWeight: 700, flex: 1 };
const boldValue: React.CSSProperties = { fontWeight: 600, flex: 1 };

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
    <SectionCard
      title={
        <Stack direction='row' spacing={2} align='center'>
          <Text weight="semibold" size="sm">Tags</Text>
          <Text size="xs" tone="muted">({tags.length})</Text>
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
      bodyPadding={0}
    >
        {/* Header row */}
        <div className={styles.headerRow}>
          <Text size="xs" style={boldFlex}>Key</Text>
          <Text size="xs" style={boldFlex}>Value</Text>
          {!readOnly && <div style={{ width: 32 }} />}
        </div>

        {/* Tag rows */}
        {tags.map((tag, i) => (
          <div
            key={i}
            className={styles.row}
          >
            {readOnly ? (
              <>
                <Text size="xs" mono style={flex1}>{tag.Key}</Text>
                <Text size="xs" mono style={boldValue}>{tag.Value}</Text>
              </>
            ) : (
              <>
                <TextInput
                  size='sm'
                  variant='ghost'
                  mono
                  value={tag.Key}
                  onChange={(value) => handleKeyChange(i, value)}
                  style={flex1}
                />
                <TextInput
                  size='sm'
                  variant='ghost'
                  mono
                  value={tag.Value}
                  onChange={(value) => handleValueChange(i, value)}
                  style={flex1}
                />
                <IconButton size='sm' variant='ghost' color='danger' aria-label='Remove' onClick={() => handleRemove(i)}>
                  <LuTrash2 size={14} />
                </IconButton>
              </>
            )}
          </div>
        ))}

        {tags.length === 0 && (
          <div className={styles.empty}>
            <Text size="xs" tone="muted">No tags</Text>
          </div>
        )}

        {/* Add row */}
        {!readOnly && tags.length < maxTags && (
          <>
            <Separator />
            <div className={styles.addRow}>
              <TextInput
                size='sm'
                placeholder='Key'
                value={newKey}
                onChange={(value) => setNewKey(value)}
                onKeyDown={handleKeyDown}
                style={flex1}
              />
              <TextInput
                size='sm'
                placeholder='Value'
                value={newValue}
                onChange={(value) => setNewValue(value)}
                onKeyDown={handleKeyDown}
                style={flex1}
              />
              <IconButton
                size='sm'
                variant='soft'
                color='brand'
                aria-label='Add'
                disabled={!newKey.trim()}
                onClick={handleAdd}
              >
                <LuPlus size={14} />
              </IconButton>
            </div>
          </>
        )}
    </SectionCard>
  );
};

export default TagEditor;
