import { useRightDrawer } from '@omniviewdev/runtime'
import { RowSelectionState, Table } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { type Props as ResourceTableProps } from './ResourceTable'
import React from 'react'
import ResourceTableRow from './ResourceTableRowContainer'

type Props = Omit<ResourceTableProps, 'columns' | 'idAccessor'> & {
  table: Table<any>
  tableContainerRef: React.RefObject<HTMLDivElement>
  columnVisibility: string
  rowSelection: RowSelectionState
}

const ResourceTableBody: React.FC<Props> = ({ table, tableContainerRef, drawer, resourceKey, connectionID, memoizer, columnVisibility, rowSelection, onRowClick: onRowClickProp }) => {
  const { rows } = table.getRowModel();
  const { openDrawer } = useRightDrawer()

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLTableRowElement>({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 32,
    overscan: 50,
    measureElement:
      typeof window !== 'undefined' &&
        navigator.userAgent.indexOf('Firefox') === -1
        ? element => element?.getBoundingClientRect().height
        : undefined,
  });

  const onRowClick = React.useCallback((id: string, data: any) => {
    if (onRowClickProp) {
      onRowClickProp(id, data);
      return;
    }
    if (drawer === undefined) {
      return
    }
    openDrawer(drawer, {
      data,
      resource: {
        id,
        key: resourceKey,
        connectionID
      }
    })
  }, [drawer, onRowClickProp])

  return (
    <tbody
      style={{
        display: 'grid',
        height: `${virtualizer.getTotalSize()}px`,
        position: 'relative',
      }}
    >
      {virtualizer.getVirtualItems().map(virtualRow => {
        const row = rows[virtualRow.index];
        return (
          <ResourceTableRow
            key={row.id}
            connectionID={connectionID}
            resourceID={row.id}
            resourceKey={resourceKey}
            row={row}
            memoizer={memoizer}
            virtualRow={virtualRow}
            rowVirtualizer={virtualizer}
            isSelected={rowSelection[row.id]}
            columnVisibility={columnVisibility}
            onRowClick={onRowClick}
          />
        );
      })}
    </tbody>
  )
}

export default ResourceTableBody
