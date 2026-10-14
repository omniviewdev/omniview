import React, { useState } from 'react';
import { Button, IconButton, Separator, Stack, Text } from '@omniviewdev/base-ui';
import SectionCard from '../ui/SectionCard';
import TextInput from '../ui/TextInput';
import styles from './EditorRows.module.css';
import { LuPlus, LuTrash2 } from 'react-icons/lu';

const flex1: React.CSSProperties = { flex: 1 };
const boldFlex: React.CSSProperties = { fontWeight: 700, flex: 1 };
const boldValue: React.CSSProperties = { fontWeight: 600, flex: 1 };

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
    <SectionCard
      title={
        <Stack direction='row' spacing={2} align='center'>
          <Text weight="semibold" size="sm">{title}</Text>
          <Text size="xs" tone="muted">({pairs.length})</Text>
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
        {/* Header */}
        <div className={styles.headerRow}>
          <Text size="xs" style={boldFlex}>{keyLabel}</Text>
          <Text size="xs" style={boldFlex}>{valueLabel}</Text>
          {!readOnly && <div style={{ width: 32 }} />}
        </div>

        {/* Rows */}
        {pairs.map(([key, value]) => (
          <div
            key={key}
            className={styles.row}
          >
            {readOnly || fixedKeys ? (
              <Text size="xs" mono style={flex1}>{key}</Text>
            ) : (
              <TextInput
                size='sm'
                variant='ghost'
                mono
                value={key}
                onChange={(value) => handleKeyRename(key, value)}
                style={flex1}
              />
            )}
            {readOnly ? (
              <Text size="xs" mono style={boldValue}>{value}</Text>
            ) : (
              <TextInput
                size='sm'
                variant='ghost'
                mono
                value={value}
                onChange={(value) => handleValueChange(key, value)}
                style={flex1}
              />
            )}
            {!readOnly && (
              <IconButton size='sm' variant='ghost' color='danger' aria-label='Remove' onClick={() => handleRemove(key)}>
                <LuTrash2 size={14} />
              </IconButton>
            )}
          </div>
        ))}

        {pairs.length === 0 && (
          <div className={styles.empty}>
            <Text size="xs" tone="muted">No entries</Text>
          </div>
        )}

        {/* Add row */}
        {!readOnly && (
          <>
            <Separator />
            <div className={styles.addRow}>
              <TextInput
                size='sm'
                placeholder={keyPlaceholder}
                value={newKey}
                onChange={(value) => setNewKey(value)}
                onKeyDown={handleKeyDown}
                style={flex1}
              />
              <TextInput
                size='sm'
                placeholder={valuePlaceholder}
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

export default KeyValueEditor;
