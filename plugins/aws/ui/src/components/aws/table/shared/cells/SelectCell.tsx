import { type Row } from '@tanstack/react-table';
import Box from '@mui/material/Box';
import { Checkbox } from '@omniviewdev/ui/inputs';

export const SelectCell = ({ row }: { row: Row<any> }) => (
  <Box sx={{
    display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', maxWidth: 24
  }}>
    <Checkbox
      size='sm'
      checked={row.getIsSelected()}
      onChange={(checked) => {
        row.toggleSelected(checked);
      }}
      aria-label='Select row'
    />
  </Box>
);

SelectCell.displayName = 'SelectCell';
export default SelectCell;
