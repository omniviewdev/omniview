/** Function or path to derive a memoization key from row data */
export type Memoizer = string | string[] | ((data: any) => string);

/** Function or path to derive a unique ID from row data */
export type IdAccessor = string | ((data: any) => string);
