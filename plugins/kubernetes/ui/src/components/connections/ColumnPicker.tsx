import React from 'react';
import { Checkbox, IconButton, List, ListItem, Sheet, Typography } from '@mui/joy';
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
  const anchorRef = React.useRef<HTMLButtonElement>(null);

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
        ref={anchorRef}
        size='sm'
        variant='plain'
        color='neutral'
        onClick={() => setOpen(prev => !prev)}
        title='Select visible columns'
      >
        <LuColumns3 size={16} />
      </IconButton>
      {open && (
        <>
          {/* Backdrop */}
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 999 }}
            onClick={() => setOpen(false)}
          />
          <Sheet
            variant='outlined'
            sx={{
              position: 'absolute',
              right: 0,
              top: '100%',
              mt: 0.5,
              zIndex: 1000,
              borderRadius: 'sm',
              boxShadow: 'md',
              minWidth: 180,
              maxHeight: 300,
              overflow: 'auto',
              p: 1,
            }}
          >
            <Typography level='body-xs' fontWeight={600} sx={{ px: 1, pb: 0.5 }}>
              Visible Columns
            </Typography>
            <List size='sm'>
              {sorted.map(col => (
                <ListItem key={col}>
                  <Checkbox
                    size='sm'
                    label={formatColumnName(col)}
                    checked={visibleColumns.includes(col)}
                    onChange={() => onToggleColumn(col)}
                  />
                </ListItem>
              ))}
            </List>
          </Sheet>
        </>
      )}
    </>
  );
};

export default ColumnPicker;
