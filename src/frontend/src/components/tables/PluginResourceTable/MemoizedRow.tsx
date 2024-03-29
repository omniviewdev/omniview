import { memo } from 'react';

// Tanstack/react-table
import {
  type Row,
  flexRender,
} from '@tanstack/react-table';
import useRightDrawer from '@/hooks/useRightDrawer';

export type MemoizedRowProps = {
  pluginID: string;
  connectionID: string;
  row: Row<any>;
  kind: string;
};

/**
* Since we're using Kubernetes objects here which have some fields to help us identify
* whether or not the data has changed, we can use memoization checks to avoid
* unnecessary re-renders.
*/
export const MemoizedRow = memo(({ pluginID, connectionID, row, kind }: MemoizedRowProps) => {
  const { showResourceSidebar } = useRightDrawer();

  // Simplified memoization check can be done outside, based on your needs
  return (
    <tr style={{ cursor: 'pointer' }} >
      {row.getVisibleCells().map(cell => (
        <td
          key={cell.id}
          onClick={cell.column.id === 'name' ? () => {
            showResourceSidebar({ 
              pluginID, 
              connectionID, 
              resourceKey: kind, 
              resourceID: cell.row.original.metadata.name,
              namespace: cell.row.original.metadata.namespace,
            });
          } : undefined}
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
}, (prevProps, nextProps) =>
// Example memoization condition, adjust according to your actual needs
  prevProps.row.original.metadata?.uid === nextProps.row.original.metadata?.uid
    && prevProps.row.original.metadata?.resourceVersion === nextProps.row.original.metadata?.resourceVersion,
);

MemoizedRow.displayName = 'MemoizedRow';
