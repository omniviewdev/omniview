export type Order = 'asc' | 'desc';

function descendingComparator<T>(a: T, b: T, orderBy: string): number {
  // Function to safely get the nested property
  const getNestedProperty = (object: any, path: string): any => {
    return path.split('.').reduce((obj, prop) => obj ? obj[prop] : undefined, object);
  };

  const aValue = getNestedProperty(a, orderBy);
  const bValue = getNestedProperty(b, orderBy);

  // Adjust comparison logic to handle undefined values as needed
  if (bValue < aValue) {
    return -1;
  }
  if (bValue > aValue) {
    return 1;
  }
  return 0;
}

export function getComparator<T>(order: Order, orderBy: string): (a: T, b: T) => number {
  return order === 'desc'
    ? (a, b) => descendingComparator(a, b, orderBy)
    : (a, b) => -descendingComparator(a, b, orderBy);
}


// Since 2020 all major browsers ensure sort stability with Array.prototype.sort().
// stableSort() brings sort stability to non-modern browsers (notably IE11). If you
// only support modern browsers you can replace stableSort(exampleArray, exampleComparator)
// with exampleArray.slice().sort(exampleComparator)
export function stableSort<T>(
  array: readonly T[],
  comparator: (a: T, b: T) => number
) {
  const stabilizedThis = array.map((el, index) => [el, index] as [T, number]);
  stabilizedThis.sort((a, b) => {
    const order = comparator(a[0], b[0]);
    if (order !== 0) {
      return order;
    }
    return a[1] - b[1];
  });
  return stabilizedThis.map((el) => el[0]);
}
