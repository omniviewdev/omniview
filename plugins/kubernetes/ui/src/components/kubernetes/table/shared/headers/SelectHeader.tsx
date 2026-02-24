import { type Table } from '@tanstack/react-table';

import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';

/**
 * Render a selectbox for the header of the generic resource table.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SelectBoxHeader = ({ table }: { table: Table<any> }) => (
  <Box sx={{
    display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', maxWidth: 24
  }}>
    <Checkbox
      size='small'
      checked={table.getIsAllPageRowsSelected()}
      indeterminate={table.getIsSomePageRowsSelected()}
      onChange={event => {
        table.toggleAllPageRowsSelected(event.target.checked);
      }}
      aria-label='Select all nodes'
      sx={{
        p: 0,
        color: 'var(--ov-fg-faint)',
        '&.Mui-checked, &.MuiCheckbox-indeterminate': {
          color: 'var(--ov-accent-fg)',
        },
      }}
    />
  </Box>
);

SelectBoxHeader.displayName = 'SelectBoxHeader';

export default SelectBoxHeader;
