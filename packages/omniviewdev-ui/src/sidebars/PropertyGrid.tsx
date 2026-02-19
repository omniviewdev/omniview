import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import MuiCheckbox from '@mui/material/Checkbox';
import InputBase from '@mui/material/InputBase';
import type { SxProps, Theme } from '@mui/material/styles';

import type { ComponentSize } from '../types';
import type { PropertyGridItem } from './types';

export interface PropertyGridProps {
  items: PropertyGridItem[];
  columns?: 1 | 2;
  size?: ComponentSize;
  editable?: boolean;
  onEdit?: (key: string, value: string) => void;
  sx?: SxProps<Theme>;
}

const fontSizeMap: Record<ComponentSize, string> = {
  xs: '11px',
  sm: '12px',
  md: '12px',
  lg: '13px',
  xl: '14px',
};

const rowHeightMap: Record<ComponentSize, number> = {
  xs: 22,
  sm: 24,
  md: 26,
  lg: 30,
  xl: 34,
};

function PropertyRow({
  item,
  size,
  editable,
  onEdit,
  striped,
}: {
  item: PropertyGridItem;
  size: ComponentSize;
  editable?: boolean;
  onEdit?: (key: string, value: string) => void;
  striped: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const fontSize = fontSizeMap[size];
  const rowHeight = rowHeightMap[size];

  const canEdit = editable || item.editable;

  const handleStartEdit = () => {
    if (!canEdit) return;
    const val = typeof item.value === 'string' ? item.value : String(item.value ?? '');
    setEditValue(val);
    setEditing(true);
  };

  const handleCommit = () => {
    setEditing(false);
    onEdit?.(item.key, editValue);
  };

  const renderValue = () => {
    if (editing) {
      return (
        <InputBase
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleCommit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleCommit();
            if (e.key === 'Escape') setEditing(false);
          }}
          autoFocus
          sx={{ fontSize, flex: 1, '& input': { py: 0, px: 0.5 } }}
        />
      );
    }

    if (item.type === 'boolean') {
      return (
        <MuiCheckbox
          checked={item.value === true || item.value === 'true'}
          size="small"
          disabled={!canEdit}
          sx={{ p: 0 }}
        />
      );
    }

    if (item.type === 'color' && typeof item.value === 'string') {
      return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box
            sx={{
              width: 12,
              height: 12,
              borderRadius: 0.5,
              bgcolor: item.value,
              border: '1px solid var(--ov-border-default)',
              flexShrink: 0,
            }}
          />
          <Typography variant="body2" sx={{ fontSize, color: 'inherit', fontFamily: 'var(--ov-font-mono)' }} noWrap>
            {item.value}
          </Typography>
        </Box>
      );
    }

    if (item.type === 'code') {
      return (
        <Typography variant="body2" sx={{ fontSize, color: 'inherit', fontFamily: 'var(--ov-font-mono)' }} noWrap>
          {item.value}
        </Typography>
      );
    }

    if (item.type === 'link') {
      return (
        <Typography
          variant="body2"
          sx={{ fontSize, color: 'var(--ov-accent-fg)', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
          noWrap
        >
          {item.value}
        </Typography>
      );
    }

    return (
      <Typography variant="body2" sx={{ fontSize, color: 'inherit' }} noWrap>
        {item.value}
      </Typography>
    );
  };

  return (
    <Box
      onDoubleClick={handleStartEdit}
      sx={{
        display: 'flex',
        alignItems: 'center',
        minHeight: rowHeight,
        px: 1,
        gap: 1,
        bgcolor: striped ? 'var(--ov-state-hover)' : 'transparent',
        '&:hover': { bgcolor: 'var(--ov-state-hover)' },
      }}
    >
      <Typography
        variant="body2"
        sx={{
          width: '40%',
          minWidth: '40%',
          fontSize,
          color: 'var(--ov-fg-muted)',
          fontWeight: 500,
        }}
        noWrap
      >
        {item.label}
      </Typography>
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', overflow: 'hidden', color: 'var(--ov-fg-default)' }}>
        {renderValue()}
      </Box>
    </Box>
  );
}

export default function PropertyGrid({
  items,
  columns = 1,
  size = 'md',
  editable = false,
  onEdit,
  sx,
}: PropertyGridProps) {
  if (columns === 2) {
    const mid = Math.ceil(items.length / 2);
    const left = items.slice(0, mid);
    const right = items.slice(mid);
    return (
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}) } as SxProps<Theme>}>
        <Box>
          {left.map((item, i) => (
            <PropertyRow key={item.key} item={item} size={size} editable={editable} onEdit={onEdit} striped={i % 2 === 1} />
          ))}
        </Box>
        <Box>
          {right.map((item, i) => (
            <PropertyRow key={item.key} item={item} size={size} editable={editable} onEdit={onEdit} striped={i % 2 === 1} />
          ))}
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={sx}>
      {items.map((item, i) => (
        <PropertyRow key={item.key} item={item} size={size} editable={editable} onEdit={onEdit} striped={i % 2 === 1} />
      ))}
    </Box>
  );
}

PropertyGrid.displayName = 'PropertyGrid';
