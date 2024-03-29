import { useCallback, memo } from 'react';

// Tanstack/react-table
import {
  type Row,
  flexRender,
} from '@tanstack/react-table';
import { type VirtualItem, type useVirtualizer } from '@tanstack/react-virtual';

type RowComponentProps = {
  virtualizer: ReturnType<typeof useVirtualizer>;
  virtualRow: VirtualItem;
  row: Row<any>;
  resourceKey: string;
  isSelected: boolean;
  uniquers: string[];
};

/**
 * Generate a unique key for the row to use in memoization.
 */
const getUniqueKey = (row: Row<any>, uniquers: string[]) => uniquers.map(key => row.original[key]).join('-');

// Import useRightDrawer or any relevant hooks/context if necessary
const RowComponent: React.FC<RowComponentProps> = memo(({ virtualizer, virtualRow, row, isSelected }) => {
  console.log('RowComponent', row.original);
  // Assuming useRightDrawer is a hook that provides showResourceSpec function
  // const { showResourceSidebar } = useRightDrawer();

  // Use the provided ref callback to measure items
  const ref = useCallback((node: HTMLTableRowElement) => {
    virtualizer.measureElement(node);
  }, [virtualizer, virtualRow.index]);

  return (
    <tr
      data-index={virtualRow.index}
      ref={ref} // Measure dynamic row height
      key={row.id}
      data-state={isSelected ? 'selected' : undefined}
      style={{
        display: 'flex',
        position: 'absolute',
        transform: `translateY(${virtualRow.start}px)`, // This should always be a `style` as it changes on scroll
        width: '100%',
      }}
    >
      {row.getVisibleCells().map(cell => {
        const width = cell.column.getSize() === Number.MAX_SAFE_INTEGER ? 'auto' : cell.column.getSize();
        return (
          <td
            key={cell.id}
            // onClick={cell.column.id === 'name' ? () => {
            // } : undefined}
            style={{
              display: 'flex',
              alignItems: 'center',
              maxWidth: width,
              minWidth: width,
              flexGrow: 1,
              textOverflow: 'ellipsis',
              overflow: 'hidden',
            }}
          >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </td>
        );
      })}
    </tr>
  );
}, (prevProps, nextProps) => getUniqueKey(prevProps.row, prevProps.uniquers) === getUniqueKey(nextProps.row, nextProps.uniquers)
    && prevProps.virtualRow.start === nextProps.virtualRow.start
    && prevProps.isSelected === nextProps.isSelected);

RowComponent.displayName = 'RowComponent';
export default RowComponent;

