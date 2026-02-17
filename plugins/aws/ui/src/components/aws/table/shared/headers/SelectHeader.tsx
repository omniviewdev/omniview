import { type Table } from '@tanstack/react-table';
import { Box, Checkbox } from '@mui/joy';

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
      aria-label='Select all'
    />
  </Box>
);

SelectBoxHeader.displayName = 'SelectBoxHeader';
export default SelectBoxHeader;
