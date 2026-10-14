import React from 'react';
import {
  type Row,
  flexRender,
} from '@tanstack/react-table';
import { type Memoizer } from './types';
import { type Virtualizer, type VirtualItem } from '@tanstack/react-virtual';
import { getCellStyles } from './utils';
import styles from './ResourceTable.module.css';

export type Props<T = any> = {
  memoizer?: Memoizer;
  resourceKey: string;
  resourceID: string;
  connectionID: string;
  columnVisibility: string;
  virtualRow: VirtualItem;
  rowVirtualizer: Virtualizer<HTMLDivElement, HTMLTableRowElement>;
  isSelected: boolean;
  onRowClick: (id: string, data: any) => void;
  row: Row<T>;
};

/**
 * A virtualized table row. Renders its own cells (rather than using base-ui's
 * DataTable.VirtualBody) so live in-place data updates always re-render.
 */
export const RowContainer: React.FC<Props> = ({
  resourceID,
  virtualRow,
  rowVirtualizer,
  isSelected,
  row,
  onRowClick,
}) => {
  const handleRowClick = (column: string) => {
    if (column !== 'select' && column !== 'menu') {
      onRowClick(resourceID, row.original)
    }
  };

  return (
    <tr
      data-index={virtualRow.index}
      ref={node => rowVirtualizer.measureElement(node)}
      key={row.id}
      data-state={isSelected ? 'selected' : undefined}
      className={styles.row}
      style={{ transform: `translateY(${virtualRow.start}px)` }}
    >
      {row.getVisibleCells().map(cell => (
        <td
          key={cell.id}
          className={styles.cell}
          data-pinned={cell.column.getIsPinned() || undefined}
          onClick={() => {
            handleRowClick(cell.column.id);
          }}
          style={getCellStyles(cell.column)}
        >
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </td>
      ))}
    </tr>
  );
};

RowContainer.displayName = 'RowContainer';
export default RowContainer;
