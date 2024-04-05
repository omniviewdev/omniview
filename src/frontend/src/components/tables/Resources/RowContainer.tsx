import React from 'react';

// Tanstack/react-table
import {
  type Row,
  flexRender,
} from '@tanstack/react-table';
import useRightDrawer from '@/hooks/useRightDrawer';

import { type Memoizer } from './ResourceTableContainer';
import { type Virtualizer, type VirtualItem } from '@tanstack/react-virtual';

export type Props = {
  /** ID of the plugin */
  pluginID: string;
  /** ID of the connection */
  connectionID: string;
  /** ID of this resource */
  resourceID: string;
  /** The hash key of this resource type. For exaample, 'core::v1::Pod' */
  resourceKey: string;
  /** The resource namespace is the backend used the namespacing support. */
  namespace?: string;
  /** An optional memoizer function to optimize rendering */
  memoizer?: Memoizer;
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  virtualRow: VirtualItem;
  isSelected: boolean;
  /** The row data */
  row: Row<any>;
  columnVisibility: string;
};

/**
 * The row container component for the resource table. Responsible for rendering the row contents, and optionally
 * memoizing the cells based on the memoizer function provided.
 */
export const RowContainer: React.FC<Props> = ({ 
  pluginID, 
  connectionID, 
  resourceID,
  resourceKey,
  namespace = '',
  virtualizer,
  virtualRow,
  isSelected,
  row,
}) => {
  const { showResourceSidebar } = useRightDrawer();

  // Use the provided ref callback to measure items
  const ref = React.useCallback((node: HTMLTableRowElement) => {
    virtualizer.measureElement(node);
  }, [virtualizer, virtualRow.index]);

  const handleRowClick = (column: string) => {
    if (column !== 'select' && column !== 'menu') {
      showResourceSidebar({ 
        pluginID, 
        connectionID, 
        resourceKey, 
        resourceID,
        namespace,
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

