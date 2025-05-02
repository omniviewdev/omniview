import { CSSProperties } from "react"
import { Column } from "@tanstack/react-table"

export const getCommonPinningStyles = <T = any>(column: Column<T>, header: boolean): CSSProperties => {
  const isPinned = column.getIsPinned()
  const isLastLeftPinnedColumn =
    isPinned === 'left' && column.getIsLastColumn('left')
  const isFirstRightPinnedColumn =
    isPinned === 'right' && column.getIsFirstColumn('right')

  return {
    boxShadow: isLastLeftPinnedColumn
      ? '-1px 0 1px -1px gray inset'
      : isFirstRightPinnedColumn
        ? '1px 0 1px -1px gray inset'
        : undefined,
    left: isPinned === 'left' ? `${column.getStart('left')}px` : undefined,
    right: isPinned === 'right' ? `${column.getAfter('right')}px` : undefined,
    position: isPinned ? 'sticky' : 'relative',
    width: column.getSize(),
    zIndex: isPinned ? 1 : 0,
    backgroundColor: isPinned && !header ? 'var(--joy-palette-background-body)' : undefined
  }
}
