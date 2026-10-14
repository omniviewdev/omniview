import { type Row } from '@tanstack/react-table';
import { Checkbox } from '@omniviewdev/base-ui';
import type { CSSProperties } from 'react';

const wrapperStyle: CSSProperties = {
  display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', maxWidth: 24,
};

export const SelectCell = ({ row }: { row: Row<any> }) => (
  <div style={wrapperStyle}>
    <Checkbox
      size='sm'
      checked={row.getIsSelected()}
      onCheckedChange={(checked) => {
        row.toggleSelected(checked);
      }}
      aria-label='Select row'
    />
  </div>
);

SelectCell.displayName = 'SelectCell';
export default SelectCell;
