import type { DataTableFeatures } from '@omniviewdev/base-ui';
import { Subscribe, type CellContext } from '@tanstack/react-table';
import type { ResourceTableRow } from '@/hooks/resource/useResourceDefinition';

import { Checkbox } from '@omniviewdev/base-ui';
import styles from './cells.module.css';

/**
 * Render a selectbox for a row of the generic resource table.
 */
export const SelectBoxRow = ({ row, table }: CellContext<DataTableFeatures, ResourceTableRow>) => (
  <Subscribe source={table.atoms.rowSelection} selector={(selection) => !!selection[row.id]}>
    {(checked) => (
      <div className={styles.SelectBox}>
        <Checkbox
          size='sm'
          checked={checked}
          onCheckedChange={checked => {
            row.toggleSelected(checked);
          }}
          aria-label='Select node'
        />
      </div>
    )}
  </Subscribe>
);

SelectBoxRow.displayName = 'SelectBoxRow';
export default SelectBoxRow;
