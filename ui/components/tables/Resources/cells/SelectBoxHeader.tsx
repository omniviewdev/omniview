import type { DataTableFeatures } from '@omniviewdev/base-ui';
import { Subscribe, type Table } from '@tanstack/react-table';
import type { ResourceTableRow } from '@/hooks/resource/useResourceDefinition';

import { Checkbox } from '@omniviewdev/base-ui';
import styles from './cells.module.css';

/**
 * Render a selectbox for the header of the generic resource table.
 */
export const SelectBoxHeader = ({ table }: { table: Table<DataTableFeatures, ResourceTableRow> }) => (
  <Subscribe source={table.store} selector={(state) => [state.rowSelection, state.columnFilters, state.globalFilter, state.pagination]}>
    {() => (
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
    )}
  </Subscribe>
);

SelectBoxHeader.displayName = 'SelectBoxHeader';

export default SelectBoxHeader;
