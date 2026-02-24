import React, { useState } from 'react';

import ClickAwayListener from '@mui/material/ClickAwayListener';
import Popper from '@mui/material/Popper';
import Box from '@mui/material/Box';
import MuiCheckbox from '@mui/material/Checkbox';
import InputBase from '@mui/material/InputBase';
import { IconButton } from '@omniviewdev/ui/buttons';
import { Text } from '@omniviewdev/ui/typography';

import { type Column } from '@tanstack/react-table';
import { LuColumns2, LuSettings2, LuTag, LuStickyNote, LuSearch } from 'react-icons/lu';

type Props = {
  labels: Record<string, boolean>;
  setLabels: (vals: Record<string, boolean>) => void;
  annotations: Record<string, boolean>
  setAnnotations: (vals: Record<string, boolean>) => void;
  anchorEl: HTMLElement | undefined;
  columns: Array<Column<any>>;
  onClose: () => void;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
};

/** Compact section header */
const SectionHeader: React.FC<{ icon: React.ReactNode; title: string; count?: number }> = ({ icon, title, count }) => (
  <Box sx={{
    display: 'flex',
    alignItems: 'center',
    gap: 0.75,
    px: 1.5,
    py: 0.75,
    bgcolor: 'var(--ov-bg-surface)',
    borderBottom: '1px solid var(--ov-border-muted)',
  }}>
    <Box sx={{ display: 'flex', color: 'var(--ov-fg-faint)', fontSize: 12 }}>{icon}</Box>
    <Text weight='semibold' size='xs' sx={{ color: 'var(--ov-fg-muted)', flex: 1 }}>{title}</Text>
    {count !== undefined && count > 0 && (
      <Text size='xs' sx={{ color: 'var(--ov-fg-faint)' }}>{count}</Text>
    )}
  </Box>
);

/** Compact checkbox row */
const CheckRow: React.FC<{ label: string; checked: boolean; onChange: () => void }> = ({ label, checked, onChange }) => (
  <Box
    component='label'
    onClick={onChange}
    sx={{
      display: 'flex',
      alignItems: 'center',
      gap: 0.5,
      px: 1,
      py: 0,
      height: 26,
      cursor: 'pointer',
      '&:hover': { bgcolor: 'var(--ov-state-hover)' },
    }}
  >
    <MuiCheckbox
      size='small'
      checked={checked}
      tabIndex={-1}
      sx={{
        p: 0,
        color: 'var(--ov-fg-faint)',
        '&.Mui-checked': { color: 'var(--ov-accent-fg)' },
        '& .MuiSvgIcon-root': { fontSize: 16 },
      }}
    />
    <Text size='xs' sx={{
      color: checked ? 'var(--ov-fg-default)' : 'var(--ov-fg-muted)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }}>{label}</Text>
  </Box>
);

/** Inline search for long lists */
const ListSearch: React.FC<{ value: string; onChange: (v: string) => void; placeholder?: string }> = ({ value, onChange, placeholder }) => (
  <Box sx={{
    display: 'flex',
    alignItems: 'center',
    mx: 1,
    my: 0.5,
    height: 24,
    border: '1px solid var(--ov-border-default)',
    borderRadius: '3px',
    bgcolor: 'var(--ov-bg-base)',
    px: 0.5,
    '&:focus-within': { borderColor: 'var(--ov-accent)' },
  }}>
    <LuSearch size={11} style={{ color: 'var(--ov-fg-faint)', marginRight: 4, flexShrink: 0 }} />
    <InputBase
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      sx={{
        flex: 1,
        fontSize: '0.6875rem',
        color: 'var(--ov-fg-default)',
        '& input': { py: 0, px: 0 },
        '& input::placeholder': { color: 'var(--ov-fg-faint)', opacity: 1 },
      }}
    />
  </Box>
);

const ColumnFilter: React.FC<Props> = ({
  labels,
  setLabels,
  annotations,
  setAnnotations,
  anchorEl,
  columns,
  onClose,
  onClick
}) => {
  const open = Boolean(anchorEl);
  const [labelSearch, setLabelSearch] = useState('');
  const [annotationSearch, setAnnotationSearch] = useState('');

  const hideable = columns.filter(col => col.getCanHide());
  const labelList = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  const annotationList = Object.entries(annotations).sort(([a], [b]) => a.localeCompare(b));

  const filteredLabels = labelSearch
    ? labelList.filter(([k]) => k.toLowerCase().includes(labelSearch.toLowerCase()))
    : labelList;
  const filteredAnnotations = annotationSearch
    ? annotationList.filter(([k]) => k.toLowerCase().includes(annotationSearch.toLowerCase()))
    : annotationList;

  const enabledLabelCount = labelList.filter(([, v]) => v).length;
  const enabledAnnotationCount = annotationList.filter(([, v]) => v).length;

  return (
    <React.Fragment>
      <IconButton
        emphasis='outline'
        color='neutral'
        onClick={onClick}
        sx={{ width: 28, height: 28 }}
      >
        <LuSettings2 size={14} />
      </IconButton>
      <Popper
        style={{ zIndex: 1000 }}
        id='table-filter-menu'
        open={open}
        anchorEl={anchorEl}
        placement='bottom-end'
      >
        <ClickAwayListener onClickAway={onClose}>
          <Box sx={{
            width: 300,
            maxHeight: '60vh',
            overflow: 'auto',
            border: '1px solid var(--ov-border-default)',
            borderRadius: '6px',
            bgcolor: 'var(--ov-bg-base)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            mt: 0.5,
          }}>
            {/* Columns section */}
            <SectionHeader icon={<LuColumns2 size={12} />} title='Columns' />
            <Box sx={{ py: 0.5 }}>
              {hideable.map(column => (
                <CheckRow
                  key={column.id}
                  label={column.columnDef.header?.toString() ?? column.id}
                  checked={column.getIsVisible()}
                  onChange={column.getToggleVisibilityHandler() as () => void}
                />
              ))}
            </Box>

            {/* Labels section */}
            {labelList.length > 0 && (
              <>
                <SectionHeader
                  icon={<LuTag size={12} />}
                  title='Labels'
                  count={enabledLabelCount}
                />
                {labelList.length > 8 && (
                  <ListSearch
                    value={labelSearch}
                    onChange={setLabelSearch}
                    placeholder='Filter labels...'
                  />
                )}
                <Box sx={{ py: 0.5, maxHeight: 200, overflow: 'auto' }}>
                  {filteredLabels.map(([label, selected]) => (
                    <CheckRow
                      key={label}
                      label={label}
                      checked={selected}
                      onChange={() => setLabels({ [label]: !selected })}
                    />
                  ))}
                  {filteredLabels.length === 0 && (
                    <Text size='xs' sx={{ px: 1.5, py: 1, color: 'var(--ov-fg-faint)' }}>
                      No matching labels
                    </Text>
                  )}
                </Box>
              </>
            )}

            {/* Annotations section */}
            {annotationList.length > 0 && (
              <>
                <SectionHeader
                  icon={<LuStickyNote size={12} />}
                  title='Annotations'
                  count={enabledAnnotationCount}
                />
                {annotationList.length > 8 && (
                  <ListSearch
                    value={annotationSearch}
                    onChange={setAnnotationSearch}
                    placeholder='Filter annotations...'
                  />
                )}
                <Box sx={{ py: 0.5, maxHeight: 200, overflow: 'auto' }}>
                  {filteredAnnotations.map(([annotation, selected]) => (
                    <CheckRow
                      key={annotation}
                      label={annotation}
                      checked={selected}
                      onChange={() => setAnnotations({ [annotation]: !selected })}
                    />
                  ))}
                  {filteredAnnotations.length === 0 && (
                    <Text size='xs' sx={{ px: 1.5, py: 1, color: 'var(--ov-fg-faint)' }}>
                      No matching annotations
                    </Text>
                  )}
                </Box>
              </>
            )}
          </Box>
        </ClickAwayListener>
      </Popper>
    </React.Fragment>
  );
};

ColumnFilter.displayName = 'ColumnFilter';
ColumnFilter.whyDidYouRender = true;

export default ColumnFilter;
