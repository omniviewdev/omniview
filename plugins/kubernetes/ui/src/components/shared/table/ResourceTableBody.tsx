import { useRightDrawer } from '@omniviewdev/runtime'
import { RowSelectionState, Table } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { type Props as ResourceTableProps } from './ResourceTable'
import React from 'react'
import ResourceTableRow from './ResourceTableRow'
// import ResourceTableRow from './ResourceTableRowContainer'

type Props = Omit<ResourceTableProps, 'columns' | 'idAccessor'> & {
  table: Table<any>
  tableContainerRef: React.RefObject<HTMLDivElement | null>
  columnVisibility: string
  resizedColumnIds: string
  rowSelection: RowSelectionState
}

const ResourceTableBody: React.FC<Props> = ({ table, tableContainerRef, drawer, resourceKey, connectionID, memoizer, columnVisibility, resizedColumnIds, rowSelection }) => {
  const { rows } = table.getRowModel();
  const { openDrawer } = useRightDrawer()

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLTableRowElement>({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 30,
    overscan: 15,
  });

  /** Row Clicking */
  const onRowClick = React.useCallback((id: string, data: any) => {
    if (drawer === undefined) {
      return
    }
    openDrawer(drawer, {
      data,
      resource: {
        id,
        key: resourceKey,
        connectionID,
        pluginID: 'kubernetes',
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
            isSelected={rowSelection[row.id]}
            columnVisibility={columnVisibility}
            resizedColumnIds={resizedColumnIds}
            onRowClick={onRowClick}
          />
        );
      })}
    </tbody>
  )
}

export default ResourceTableBody
