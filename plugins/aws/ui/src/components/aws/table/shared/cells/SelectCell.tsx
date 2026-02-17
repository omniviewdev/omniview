import { type Row } from '@tanstack/react-table';
import { Box, Checkbox } from '@mui/joy';

export const SelectCell = ({ row }: { row: Row<any> }) => (
  <Box sx={{
    display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', maxWidth: 24
  }}>
    <Checkbox
      size='sm'
      checked={row.getIsSelected()}
      onChange={event => {
        row.toggleSelected(event.target.checked);
      }}
      aria-label='Select row'
    />
  </Box>
);

SelectCell.displayName = 'SelectCell';
export default SelectCell;
