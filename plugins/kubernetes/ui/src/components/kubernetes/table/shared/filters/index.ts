import { FilterFn } from "@tanstack/react-table";

/**
 * Used for filtering namespaces
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const namespaceFilter: FilterFn<any> = (row, columnId, value: string[]) => {
  // If not selected namespaces, return true
  if (!value?.length) {
    return true;
  }

  return value.includes(row.getValue(columnId));
};
