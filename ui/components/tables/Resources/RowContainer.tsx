import type { DataTableFeatures } from '@omniviewdev/base-ui';
import React from 'react';

// Tanstack/react-table
import {
  type Row,
  flexRender,
} from '@tanstack/react-table';
import useRightDrawer from '@/hooks/useRightDrawer';
import { showAppError, useSnackbar } from '@omniviewdev/runtime';

import { type Virtualizer, type VirtualItem } from '@tanstack/react-virtual';
import type { ResourceTableRow } from '@/hooks/resource/useResourceDefinition';

export type Props = {
  /** ID of the plugin */
  pluginID: string;
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  virtualRow: VirtualItem;
  isSelected: boolean;
  /** The row data */
  row: Row<DataTableFeatures, ResourceTableRow>;
  columnVisibility: string;
};

/**
 * Render an observed canonical resource row and open its drawer without another read.
 */
export const RowContainer: React.FC<Props> = ({ 
  pluginID, 
  virtualizer,
  virtualRow,
  isSelected,
  row,
}) => {
  const { showResourceSidebar } = useRightDrawer();
  const { showSnackbar } = useSnackbar();
  const resourceID = row.original.record.record.reference.address.id;

  // Reattach the measurement ref when an identity-keyed row moves to a new virtual index.
  const ref = React.useCallback((node: HTMLTableRowElement) => {
    virtualizer.measureElement(node);
  }, [virtualizer, virtualRow.index]);

  const handleRowClick = (column: string) => {
    if (column !== 'select' && column !== 'menu') {
      void showResourceSidebar({
        pluginID, 
        targetId: row.original.record.targetId,
        route: row.original.record.route,
        reference: row.original.record.record.reference,
        representation: row.original.record.record.representation.id,
        record: row.original.record,
      }).catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }

        showAppError(showSnackbar, error, `Failed to load resource: ${resourceID}`);
      });
    }
  };

  //   // Simplified memoization check can be done outside, based on your needs
  return (
    <tr 
      data-index={virtualRow.index}
      ref={ref} // Measure dynamic row height
      key={row.id}
      data-state={isSelected ? 'selected' : undefined}
      style={{
        cursor: 'pointer',
        WebkitUserSelect: 'text',
        display: 'flex',
        position: 'absolute',
        transform: `translateY(${virtualRow.start}px)`, // This should always be a `style` as it changes on scroll
        width: '100%',
      }}
    >
      {row.getVisibleCells().map(cell => (
        <td
          key={cell.id}
          onClick={() => {
            handleRowClick(cell.column.id); 
          }}
          style={{
            width: cell.column.getSize() === Number.MAX_SAFE_INTEGER ? 'auto' : cell.column.getSize(),
            minWidth: cell.column.getSize() === Number.MAX_SAFE_INTEGER ? 'auto' : cell.column.getSize(),
            maxWidth: cell.column.getSize() === Number.MAX_SAFE_INTEGER ? 'auto' : cell.column.getSize(),
            display: 'flex',
            flex: 1,
            textOverflow: 'ellipsis',
            overflow: 'hidden',
          }}
        >
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </td>
      ))}
    </tr>
  );
};


RowContainer.displayName = 'RowContainer';
RowContainer.whyDidYouRender = true;
export default RowContainer;

