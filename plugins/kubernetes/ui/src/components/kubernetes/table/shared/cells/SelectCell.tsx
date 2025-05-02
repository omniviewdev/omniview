import { type Row } from '@tanstack/react-table';

import {
  Box,
  Checkbox,
} from '@mui/joy';

/**
 * Render a selectbox for a row of the generic resource table.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      aria-label='Select node'
    />
  </Box>
);

SelectCell.displayName = 'SelectCell';
export default SelectCell;
