import { useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import MuiTextField from '@mui/material/TextField';
import MuiButton from '@mui/material/Button';
import MuiIconButton from '@mui/material/IconButton';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import type { SxProps, Theme } from '@mui/material/styles';

import type { ComponentSize } from '../types';
import { toMuiSize } from '../types';

export interface KeyValueEditorProps {
  value: Record<string, string>;
  onChange: (kv: Record<string, string>) => void;
  addLabel?: string;
  readOnly?: boolean;
  validateKey?: (key: string) => string | undefined;
  validateValue?: (value: string) => string | undefined;
  size?: ComponentSize;
  sx?: SxProps<Theme>;
}

interface Row {
  id: string;
  key: string;
  value: string;
}

let nextId = 0;
function makeId() {
  return `kv-${nextId++}`;
}

function toRows(kv: Record<string, string>): Row[] {
  return Object.entries(kv).map(([key, value]) => ({ id: makeId(), key, value }));
}

function toRecord(rows: Row[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const row of rows) {
    if (row.key) result[row.key] = row.value;
  }
  return result;
}

export default function KeyValueEditor({
  value,
  onChange,
  addLabel = 'Add',
  readOnly = false,
  validateKey,
  validateValue,
  size = 'sm',
  sx,
}: KeyValueEditorProps) {
  const [rows, setRows] = useState<Row[]>(() => {
    const r = toRows(value);
    return r.length > 0 ? r : [{ id: makeId(), key: '', value: '' }];
  });

  const muiSize = toMuiSize(size) as 'small' | 'medium';

  const emit = useCallback(
    (updated: Row[]) => {
      setRows(updated);
      onChange(toRecord(updated));
    },
    [onChange],
  );

  const updateRow = (id: string, field: 'key' | 'value', val: string) => {
    emit(rows.map((r) => (r.id === id ? { ...r, [field]: val } : r)));
  };

  const removeRow = (id: string) => {
    const updated = rows.filter((r) => r.id !== id);
    emit(updated.length > 0 ? updated : [{ id: makeId(), key: '', value: '' }]);
  };

  const addRow = () => {
    emit([...rows, { id: makeId(), key: '', value: '' }]);
  };

  return (
    <Box sx={sx}>
      {rows.map((row) => {
        const keyError = validateKey ? validateKey(row.key) : undefined;
        const valError = validateValue ? validateValue(row.value) : undefined;

        return (
          <Box key={row.id} sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'center' }}>
            <MuiTextField
              value={row.key}
              onChange={(e) => updateRow(row.id, 'key', e.target.value)}
              size={muiSize}
              placeholder="Key"
              error={!!keyError}
              helperText={keyError}
              disabled={readOnly}
              sx={{ flex: 1 }}
            />
            <MuiTextField
              value={row.value}
              onChange={(e) => updateRow(row.id, 'value', e.target.value)}
              size={muiSize}
              placeholder="Value"
              error={!!valError}
              helperText={valError}
              disabled={readOnly}
              sx={{ flex: 1 }}
            />
            {!readOnly && (
              <MuiIconButton
                size="small"
                onClick={() => removeRow(row.id)}
                sx={{ color: 'var(--ov-fg-faint)', '&:hover': { color: 'var(--ov-danger-default)' } }}
              >
                <DeleteIcon fontSize="small" />
              </MuiIconButton>
            )}
          </Box>
        );
      })}
      {!readOnly && (
        <MuiButton
          size={muiSize}
          onClick={addRow}
          startIcon={<AddIcon />}
          sx={{
            color: 'var(--ov-fg-muted)',
            textTransform: 'none',
            fontWeight: 500,
            fontSize: 'var(--ov-text-sm)',
          }}
        >
          {addLabel}
        </MuiButton>
      )}
    </Box>
  );
}

KeyValueEditor.displayName = 'KeyValueEditor';
