export type Memoizer = string | string[] | ((data: any) => string);

export type IdAccessor = string | ((data: any) => string);

export type ColumnMeta = {
  meta?: {
    flex?: number;
  };
};
