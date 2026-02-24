import { type Row } from '@tanstack/react-table';

import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';

/**
 * Render a selectbox for a row of the generic resource table.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SelectCell = ({ row }: { row: Row<any> }) => (
  <Box sx={{
    display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', maxWidth: 24
  }}>
    <Checkbox
      size='small'
      checked={row.getIsSelected()}
      onChange={event => {
        row.toggleSelected(event.target.checked);
      }}
      aria-label='Select node'
      sx={{
        p: 0,
        color: 'var(--ov-fg-faint)',
        '&.Mui-checked': {
          color: 'var(--ov-accent-fg)',
        },
      }}
    />
  </Box>
);

SelectCell.displayName = 'SelectCell';
export default SelectCell;
