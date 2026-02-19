import { type Row } from '@tanstack/react-table';

import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';

/**
 * Render a selectbox for a row of the generic resource table.
 */
export const SelectBoxRow = ({ row }: { row: Row<any> }) => (
  <Box sx={{
    display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', maxWidth: 24 }}>
    <Checkbox
      size="small"
      checked={row.getIsSelected()}
      onChange={event => {
        row.toggleSelected(event.target.checked);
      }}
      aria-label="Select row"
    />
  </Box>
);

SelectBoxRow.displayName = 'SelectBoxRow';

export default SelectBoxRow;
