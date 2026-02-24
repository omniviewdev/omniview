import React from 'react';
import Box from '@mui/material/Box';
import { Checkbox } from '@omniviewdev/ui/inputs';
import { IconButton } from '@omniviewdev/ui/buttons';
import { Text } from '@omniviewdev/ui/typography';
import { LuColumns3 } from 'react-icons/lu';

type Props = {
  allColumns: string[];
  visibleColumns: string[];
  onToggleColumn: (column: string) => void;
};

function formatColumnName(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

const ColumnPicker: React.FC<Props> = ({ allColumns, visibleColumns, onToggleColumn }) => {
  const [open, setOpen] = React.useState(false);

  // Sort: visible first, then alphabetical
  const sorted = [...allColumns].sort((a, b) => {
    const aVis = visibleColumns.includes(a) ? 0 : 1;
    const bVis = visibleColumns.includes(b) ? 0 : 1;
    if (aVis !== bVis) return aVis - bVis;
    return a.localeCompare(b);
  });

  return (
    <>
      <IconButton
        size='sm'
        emphasis='ghost'
        color='neutral'
        onClick={() => setOpen(prev => !prev)}
        title='Select visible columns'
      >
        <LuColumns3 size={14} />
      </IconButton>
      {open && (
        <>
          {/* Backdrop */}
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 999 }}
            onClick={() => setOpen(false)}
          />
          <Box
            sx={{
              position: 'absolute',
              right: 0,
              top: '100%',
              mt: 0.5,
              zIndex: 1000,
              borderRadius: 'var(--ov-radius-md, 6px)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
              minWidth: 160,
              maxHeight: 280,
              overflow: 'auto',
              py: 0.5,
              px: 0.5,
              border: '1px solid var(--ov-border-default, rgba(255,255,255,0.08))',
              bgcolor: 'var(--ov-bg-surface, #1e1e1e)',
            }}
          >
            <Text size='xs' weight='semibold' sx={{ px: 0.5, pb: 0.25, color: 'var(--ov-fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.625rem' }}>
              Visible Columns
            </Text>
            {sorted.map(col => (
              <Box
                key={col}
                onClick={() => onToggleColumn(col)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.75,
                  py: 0.25,
                  px: 0.5,
                  cursor: 'pointer',
                  borderRadius: 'var(--ov-radius-sm, 4px)',
                  '&:hover': { bgcolor: 'var(--ov-bg-surface-hover, rgba(255,255,255,0.05))' },
                }}
              >
                <Checkbox
                  size='sm'
                  checked={visibleColumns.includes(col)}
                  onChange={() => onToggleColumn(col)}
                />
                <Text size='xs' sx={{ userSelect: 'none' }}>
                  {formatColumnName(col)}
                </Text>
              </Box>
            ))}
          </Box>
        </>
      )}
    </>
  );
};

export default ColumnPicker;
