import { type Table } from '@tanstack/react-table';

import { Checkbox } from '@omniviewdev/base-ui';
import styles from './cells.module.css';

/**
 * Render a selectbox for the header of the generic resource table.
 */
export const SelectBoxHeader = ({ table }: { table: Table<any> }) => (
  <div className={styles.SelectBox}>
    <Checkbox
      size='sm'
      checked={table.getIsAllPageRowsSelected()}
      onCheckedChange={checked => {
        table.toggleAllPageRowsSelected(checked);
      }}
      aria-label='Select all nodes'
    />
  </div>
);

SelectBoxHeader.displayName = 'SelectBoxHeader';

export default SelectBoxHeader;
