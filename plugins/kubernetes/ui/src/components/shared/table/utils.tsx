import { CSSProperties } from "react"
import { Column } from "@tanstack/react-table"

export const getCommonPinningStyles = <T = any>(column: Column<T>, header: boolean): CSSProperties => {
  const isPinned = column.getIsPinned()
  const isLastLeftPinnedColumn =
    isPinned === 'left' && column.getIsLastColumn('left')
  const isFirstRightPinnedColumn =
    isPinned === 'right' && column.getIsFirstColumn('right')

  const styles: CSSProperties = {
    boxShadow: isLastLeftPinnedColumn
      ? '-1px 0 1px -1px gray inset'
      : isFirstRightPinnedColumn
        ? '1px 0 1px -1px gray inset'
        : undefined,
    left: isPinned === 'left' ? `${column.getStart('left')}px` : undefined,
    right: isPinned === 'right' ? `${column.getAfter('right')}px` : undefined,
    position: isPinned ? 'sticky' : 'relative',
    width: `calc(var(--col-${column.id}-size) * 1px)`,
    zIndex: isPinned ? 1 : 0,
  }

  // Only set backgroundColor when pinned — avoids clobbering inline styles with undefined
  if (isPinned) {
    // Header pinned cells: match header surface background
    // Body pinned cells: inherit from the row so hover/selection colors show through
    styles.backgroundColor = header ? 'var(--ov-bg-surface)' : 'inherit'
  }

  return styles
}
