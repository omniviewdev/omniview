import { type Table } from '@tanstack/react-table';

import Box from '@mui/material/Box';
import { Checkbox } from '@omniviewdev/ui/inputs';

export const SelectBoxHeader = ({ table }: { table: Table<any> }) => (
  <Box sx={{
    display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', maxWidth: 24
  }}>
    <Checkbox
      size='sm'
      checked={table.getIsAllPageRowsSelected()}
      onChange={(checked) => {
        table.toggleAllPageRowsSelected(checked);
      }}
      aria-label='Select all nodes'
    />
  </Box>
);

SelectBoxHeader.displayName = 'SelectBoxHeader';

export default SelectBoxHeader;
