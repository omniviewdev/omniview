// Tanstack/react-table
import {
  type ColumnDef,
  type Row,
} from '@tanstack/react-table';

export type Props = {
  columns: Array<ColumnDef<any>>;
};

export type MemoizedRowProps = {
  /**
   * The passed in row
   */
  row: Row<any>;

  /**
  * Keys of the rows to use when determining if the row is selected
  */
  uniquers: string[];
};

