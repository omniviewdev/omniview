import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import MuiPopover from '@mui/material/Popover';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import MuiSelect from '@mui/material/Select';
import { LuPlus, LuX } from 'react-icons/lu';
import type { SxProps, Theme } from '@mui/material/styles';

export interface FilterDef {
  key: string;
  label: string;
  type: 'text' | 'select';
  options?: string[];
  placeholder?: string;
}

export interface ActiveFilter {
  key: string;
  value: string;
}

export interface FilterBarProps {
  filters: FilterDef[];
  activeFilters: ActiveFilter[];
  onChange: (filters: ActiveFilter[]) => void;
  sx?: SxProps<Theme>;
}

export default function FilterBar({
  filters,
  activeFilters,
  onChange,
  sx,
}: FilterBarProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [editingFilter, setEditingFilter] = useState<FilterDef | null>(null);
  const [editValue, setEditValue] = useState('');

  const handleAddClick = (event: React.MouseEvent<HTMLElement>, filter: FilterDef) => {
    setAnchorEl(event.currentTarget);
    setEditingFilter(filter);
    const existing = activeFilters.find((f) => f.key === filter.key);
    setEditValue(existing?.value ?? '');
  };

  const handleApply = () => {
    if (!editingFilter) return;
    const key = editingFilter.key;
    const updated = activeFilters.filter((f) => f.key !== key);
    if (editValue.trim()) {
      updated.push({ key, value: editValue.trim() });
    }
    onChange(updated);
    setAnchorEl(null);
    setEditingFilter(null);
  };

  const handleRemove = (key: string) => {
    onChange(activeFilters.filter((f) => f.key !== key));
  };

  const activeKeys = new Set(activeFilters.map((f) => f.key));

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        flexWrap: 'wrap',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {/* Active filter chips */}
      {activeFilters.map((active) => {
        const def = filters.find((f) => f.key === active.key);
        return (
          <Chip
            key={active.key}
            label={`${def?.label ?? active.key}: ${active.value}`}
            size="small"
            onDelete={() => handleRemove(active.key)}
            deleteIcon={<LuX size={12} />}
            onClick={(e) => def && handleAddClick(e, def)}
            sx={{
              fontSize: 'var(--ov-text-xs)',
              bgcolor: 'var(--ov-accent-subtle)',
              color: 'var(--ov-accent-fg)',
              '& .MuiChip-deleteIcon': { color: 'var(--ov-accent-fg)' },
            }}
          />
        );
      })}

      {/* Available filter chips */}
      {filters
        .filter((f) => !activeKeys.has(f.key))
        .map((filter) => (
          <Chip
            key={filter.key}
            label={filter.label}
            size="small"
            icon={<LuPlus size={10} />}
            onClick={(e) => handleAddClick(e, filter)}
            variant="outlined"
            sx={{
              fontSize: 'var(--ov-text-xs)',
              borderColor: 'var(--ov-border-default)',
              color: 'var(--ov-fg-muted)',
              cursor: 'pointer',
            }}
          />
        ))}

      {/* Filter popover */}
      <MuiPopover
        open={!!anchorEl}
        anchorEl={anchorEl}
        onClose={() => { setAnchorEl(null); setEditingFilter(null); }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: {
              p: 2,
              minWidth: 220,
              bgcolor: 'var(--ov-bg-surface)',
              border: '1px solid var(--ov-border-default)',
            },
          },
        }}
      >
        {editingFilter && (
          <Box>
            <Typography sx={{ fontSize: 'var(--ov-text-xs)', fontWeight: 600, color: 'var(--ov-fg-muted)', mb: 1 }}>
              {editingFilter.label}
            </Typography>

            {editingFilter.type === 'text' && (
              <TextField
                autoFocus
                size="small"
                fullWidth
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleApply(); }}
                placeholder={editingFilter.placeholder}
                sx={{ mb: 1 }}
              />
            )}

            {editingFilter.type === 'select' && editingFilter.options && (
              <MuiSelect
                size="small"
                fullWidth
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                sx={{ mb: 1 }}
              >
                {editingFilter.options.map((opt) => (
                  <MenuItem key={opt} value={opt}>{opt}</MenuItem>
                ))}
              </MuiSelect>
            )}

            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
              <Chip
                label="Apply"
                size="small"
                onClick={handleApply}
                sx={{
                  cursor: 'pointer',
                  bgcolor: 'var(--ov-accent)',
                  color: '#fff',
                  fontSize: 'var(--ov-text-xs)',
                }}
              />
            </Box>
          </Box>
        )}
      </MuiPopover>
    </Box>
  );
}

FilterBar.displayName = 'FilterBar';
