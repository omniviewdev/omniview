import { type Table } from '@tanstack/react-table';
import { Checkbox } from '@omniviewdev/base-ui';
import type { CSSProperties } from 'react';

const wrapperStyle: CSSProperties = {
  display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', maxWidth: 24,
};

export const SelectBoxHeader = ({ table }: { table: Table<any> }) => (
  <div style={wrapperStyle}>
    <Checkbox
      size='sm'
      checked={table.getIsAllPageRowsSelected()}
      onCheckedChange={(checked) => {
        table.toggleAllPageRowsSelected(checked);
      }}
      aria-label='Select all'
    />
  </div>
);

SelectBoxHeader.displayName = 'SelectBoxHeader';
export default SelectBoxHeader;
