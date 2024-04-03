import React from 'react';

// Tanstack/react-table
import {
  type Row,
  flexRender,
} from '@tanstack/react-table';
import useRightDrawer from '@/hooks/useRightDrawer';

import { type Memoizer } from './ResourceTableContainer';

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
  /** The row data */
  row: Row<any>;
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
  row,
}) => {
  const { showResourceSidebar } = useRightDrawer();

  const handleRowClick = (column: string) => {
    if (column === 'name') {
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
    <tr style={{ cursor: 'pointer', WebkitUserSelect: 'text' }} >
      {row.getVisibleCells().map(cell => (
        <td
          key={cell.id}
          onClick={() => {
            handleRowClick(cell.column.id); 
          }}
          style={{
            width: cell.column.getSize() === Number.MAX_SAFE_INTEGER ? 'auto' : cell.column.getSize(),
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

