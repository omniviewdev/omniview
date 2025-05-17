import { useRightDrawer } from '@omniviewdev/runtime'
import { RowSelectionState, Table } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { type Props as ResourceTableProps } from './ResourceTable'
import React from 'react'
import ResourceTableRow from './ResourceTableRow'
// import ResourceTableRow from './ResourceTableRowContainer'

type Props = Omit<ResourceTableProps, 'columns' | 'idAccessor'> & {
  table: Table<any>
  tableContainerRef: React.RefObject<HTMLDivElement>
  columnVisibility: string
  rowSelection: RowSelectionState
}

const ResourceTableBody: React.FC<Props> = ({ table, tableContainerRef, drawer, resourceKey, connectionID, memoizer, columnVisibility, rowSelection }) => {
  const { rows } = table.getRowModel();
  const { openDrawer } = useRightDrawer()

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLTableRowElement>({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 32, // Actual height of each row is about 36
    overscan: 50,
    measureElement:
      typeof window !== 'undefined' &&
        navigator.userAgent.indexOf('Firefox') === -1
        ? element => element?.getBoundingClientRect().height
        : undefined,
    // // Measure dynamic row height, except in firefox because it measures table border height incorrectly
    // measureElement:
    //   typeof window !== 'undefined'
    //     && !navigator.userAgent.includes('Firefox')
    //     ? element => element?.getBoundingClientRect().height
    //     : undefined,
  });

  /** Row Clicking */
  const onRowClick = React.useCallback((id: string, data: any) => {
    console.log("onRowClick called", { id, data })
    if (drawer === undefined) {
      /** nothing to do */
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
  }, [drawer])

  return (
    <tbody
      style={{
        display: 'grid',
        height: `${virtualizer.getTotalSize()}px`, // Tells scrollbar how big the table is
        position: 'relative', // Needed for absolute positioning of rows
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
