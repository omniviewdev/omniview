import { type Row } from '@tanstack/react-table';

import { Checkbox } from '@omniviewdev/base-ui';
import styles from './cells.module.css';

/**
 * Render a selectbox for a row of the generic resource table.
 */
export const SelectBoxRow = ({ row }: { row: Row<any> }) => (
  <div className={styles.SelectBox}>
    <Checkbox
      size='sm'
      checked={row.getIsSelected()}
      onCheckedChange={checked => {
        row.toggleSelected(checked);
      }}
      aria-label='Select node'
    />
  </div>
);

SelectBoxRow.displayName = 'SelectBoxRow';
export default SelectBoxRow;
