import { useMemo } from 'react';
import { type Table } from '@tanstack/react-table';

/**
 * Computes CSS custom properties from TanStack Table's column sizing state.
 * Memoized so it only recomputes when sizing actually changes — headers and
 * cells reference `var(--col-<id>-size)` instead of calling `getSize()` inline,
 * letting the browser update column widths via CSS without React re-renders.
 */
export function useColumnSizeVars<T>(table: Table<T>): Record<string, number> {
  const columnSizing = table.getState().columnSizing;
  const columnSizingInfo = table.getState().columnSizingInfo;

  return useMemo(() => {
    const headers = table.getFlatHeaders();
    const vars: Record<string, number> = {};
    for (const header of headers) {
      vars[`--header-${header.id}-size`] = header.getSize();
      vars[`--col-${header.column.id}-size`] = header.column.getSize();
    }
    return vars;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnSizing, columnSizingInfo, table]);
}
