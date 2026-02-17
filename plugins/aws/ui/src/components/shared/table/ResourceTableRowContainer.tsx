import React from 'react';
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
  row: Row<T>;
};

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
      style={{
        cursor: 'pointer',
        WebkitUserSelect: 'text',
        display: 'flex',
        position: 'absolute',
        transform: `translateY(${virtualRow.start}px)`,
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
            ...((cell.column.columnDef.meta as { flex?: number } | undefined)?.flex && {
              minWidth: cell.column.getSize(),
              flex: (cell.column.columnDef.meta as { flex?: number | undefined })?.flex
            }),
            width: cell.column.getSize(),
            display: 'flex',
            textOverflow: 'ellipsis',
            overflow: 'hidden',
            alignItems: 'center',
            whiteSpace: 'nowrap',
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
export default RowContainer;
