import React from 'react';

// Tanstack/react-table
import {
  type Row,
  flexRender,
} from '@tanstack/react-table';

import { type Memoizer } from './types';
import { type Virtualizer, type VirtualItem } from '@tanstack/react-virtual';
import { getCommonPinningStyles } from './utils';

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
  rowVirtualizer,
  isSelected,
  row,
  onRowClick,
}) => {
  // const { showResourceSidebar } = useRightDrawer();

  // Use the provided ref callback to measure items
  // const ref = React.useCallback((node: HTMLTableRowElement) => {
  //   virtualizer.measureElement(node);
  // }, [virtualizer, virtualRow.index]);

  const handleRowClick = (column: string) => {
    if (column !== 'select' && column !== 'menu') {
      onRowClick(resourceID, row.original)
    }
  };

  //   // Simplified memoization check can be done outside, based on your needs
  return (
    <tr
      data-index={virtualRow.index}
      ref={node => rowVirtualizer.measureElement(node)}
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
      {row.getVisibleCells().map(cell => (
        <td
          key={cell.id}
          onClick={() => {
            handleRowClick(cell.column.id);
          }}
          style={{
            ...((cell.column.columnDef.meta as { flex?: number } | undefined)?.flex && {
              minWidth: cell.column.getSize(),
              flex: (cell.column.columnDef.meta as { flex?: number | undefined })?.flex
            }),
            width: cell.column.getSize(),
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
      ))}
    </tr>
  );
};


RowContainer.displayName = 'RowContainer';
// RowContainer.whyDidYouRender = true;
export default RowContainer;

