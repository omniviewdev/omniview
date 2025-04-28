import { FilterFn } from "@tanstack/react-table";

/**
 * Used for filtering namespaces
 */
export const namespaceFilter: FilterFn<any> = (row, columnId, value: string[]) => {
  // If not selected namespaces, return true
  if (!value?.length) {
    return true;
  }

  return value.includes(row.getValue(columnId));
};
