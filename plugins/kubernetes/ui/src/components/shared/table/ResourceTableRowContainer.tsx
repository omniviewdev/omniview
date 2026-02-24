import React from 'react';

// Tanstack/react-table
import {
  type Row,
  flexRender,
} from '@tanstack/react-table';

import { type Memoizer } from './types';
import { type VirtualItem } from '@tanstack/react-virtual';
import { getCommonPinningStyles } from './utils';

export type Props<T = any> = {
  memoizer?: Memoizer;
  resourceKey: string;
  resourceID: string;
  connectionID: string;
  columnVisibility: string;
  resizedColumnIds: string;
  virtualRow: VirtualItem;
  isSelected: boolean;
  onRowClick: (id: string, data: any) => void;
  /** The row data */
  row: Row<T>;
};

/**
 * The row container component for the resource table. Responsible for rendering the row contents, and optionally
 * memoizing the cells based on the memoizer function provided.
 */
export const RowContainer: React.FC<Props> = ({
  resourceID,
  virtualRow,
  isSelected,
  resizedColumnIds,
  row,
  onRowClick,
}) => {
  const resizedSet: Set<string> = React.useMemo(
    () => new Set(JSON.parse(resizedColumnIds) as string[]),
    [resizedColumnIds]
  );

  const handleRowClick = (column: string) => {
    if (column !== 'select' && column !== 'menu') {
      onRowClick(resourceID, row.original)
    }
  };

  //   // Simplified memoization check can be done outside, based on your needs
  return (
    <tr
      data-index={virtualRow.index}
      key={row.id}
      data-state={isSelected ? 'selected' : undefined}
      style={{
        cursor: 'pointer',
        WebkitUserSelect: 'text',
        display: 'flex',
        position: 'absolute',
        transform: `translateY(${virtualRow.start}px)`,
        width: '100%',
        height: 30,
        backgroundColor: isSelected ? 'var(--ov-accent-subtle)' : 'var(--ov-bg-base)',
      }}
      onMouseEnter={(e) => {
        if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--ov-state-hover)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = isSelected ? 'var(--ov-accent-subtle)' : 'var(--ov-bg-base)';
      }}
    >
      {row.getVisibleCells().map(cell => {
        const flexMeta = (cell.column.columnDef.meta as { flex?: number } | undefined)?.flex;
        const isUserResized = resizedSet.has(cell.column.id);
        const applyFlex = flexMeta && !isUserResized;
        return (
          <td
            key={cell.id}
            onClick={() => {
              handleRowClick(cell.column.id);
            }}
            style={{
              ...(applyFlex && {
                minWidth: `calc(var(--col-${cell.column.id}-size) * 1px)`,
                flex: flexMeta,
              }),
              width: `calc(var(--col-${cell.column.id}-size) * 1px)`,
              display: 'flex',
              overflow: 'hidden',
              alignItems: 'center',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
              padding: '0px 8px',
              fontSize: '0.75rem',
              color: 'var(--ov-fg-default)',
              borderBottom: '1px solid var(--ov-border-muted)',
              lineHeight: '30px',
              ...getCommonPinningStyles(cell.column, false)
            }}
          >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </td>
        );
      })}
    </tr>
  );
};


RowContainer.displayName = 'RowContainer';
// RowContainer.whyDidYouRender = true;
export default RowContainer;

