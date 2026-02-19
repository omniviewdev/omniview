import { type Table } from '@tanstack/react-table';

import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';

/**
 * Render a selectbox for the header of the generic resource table.
 */
export const SelectBoxHeader = ({ table }: { table: Table<any> }) => (
  <Box sx={{
    display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', maxWidth: 24 }}>
    <Checkbox
      size="small"
      checked={table.getIsAllPageRowsSelected()}
      onChange={event => {
        table.toggleAllPageRowsSelected(event.target.checked);
      }}
      aria-label="Select all rows"
    />
  </Box>
);

SelectBoxHeader.displayName = 'SelectBoxHeader';

export default SelectBoxHeader;
