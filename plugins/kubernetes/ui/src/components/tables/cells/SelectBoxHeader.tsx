import { type Table } from '@tanstack/react-table';

import {
  Box,
  Checkbox,
} from '@mui/joy';

/**
 * Render a selectbox for the header of the generic resource table.
 */
export const SelectBoxHeader = ({ table }: { table: Table<any> }) => (
  <Box sx={{
    display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', maxWidth: 24
  }}>
    <Checkbox
      size='sm'
      checked={table.getIsAllPageRowsSelected()}
      onChange={event => {
        table.toggleAllPageRowsSelected(event.target.checked);
      }}
      aria-label='Select all nodes'
    />
  </Box>
);

SelectBoxHeader.displayName = 'SelectBoxHeader';

export default SelectBoxHeader;
