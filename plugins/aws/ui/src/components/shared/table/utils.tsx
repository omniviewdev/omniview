import { CSSProperties } from "react"
import { Column, ColumnDef } from "@tanstack/react-table"

/**
 * Inline styles for a body cell. Widths come from the `--col-<id>-size` custom properties
 * that base-ui's DataTable.Container sets on the table, so cells line up with
 * DataTable.Header. Pinned columns stay sticky.
 */
export const getCellStyles = <T = any>(column: Column<T>): CSSProperties => {
  const id = column.id
  const isPinned = column.getIsPinned()
  const isLastLeftPinnedColumn =
    isPinned === 'left' && column.getIsLastColumn('left')
  const isFirstRightPinnedColumn =
    isPinned === 'right' && column.getIsFirstColumn('right')

  const styles: CSSProperties = {
    flex: column.getCanResize()
      ? `var(--col-${id}-size) 0 0px`
      : `0 0 calc(var(--col-${id}-size) * 1px)`,
    width: `calc(var(--col-${id}-size) * 1px)`,
  }

  if (isPinned) {
    styles.position = 'sticky'
    styles.left = isPinned === 'left' ? `${column.getStart('left')}px` : undefined
    styles.right = isPinned === 'right' ? `${column.getAfter('right')}px` : undefined
    styles.zIndex = 1
    styles.boxShadow = isLastLeftPinnedColumn
      ? '-1px 0 1px -1px gray inset'
      : isFirstRightPinnedColumn
        ? '1px 0 1px -1px gray inset'
        : undefined
  }

  return styles
}

/**
 * Only columns that declare `meta.flex` grow to fill the remaining width (matching the
 * previous layout); every other column keeps its declared size. DataTable derives
 * grow/fixed from `getCanResize()`, and resize handles stay off because the
 * `columnResizing` feature is not enabled.
 */
export const withFlexSizing = <T,>(columns: Array<ColumnDef<T>>): Array<ColumnDef<T>> =>
  columns.map((col) => {
    if (col.enableResizing !== undefined) return col
    const flex = (col.meta as { flex?: number } | undefined)?.flex
    return { ...col, enableResizing: !!flex }
  })
