/* eslint @typescript-eslint/consistent-type-definitions: 0 */
/* eslint @typescript-eslint/naming-convention: 0 */
import React from 'react';

import {
  type Column,
  type RowData,
} from '@tanstack/react-table';
import { type ColorPaletteProp } from '@mui/joy';


import MultiSelectFilter from './MultiSelectFilter';
import SelectFilter from './SelectFilter';
import RangeFilter from './RangeFilter';

declare module '@tanstack/react-table' {
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: 'left' | 'center' | 'right';
    filterVariant?: 'text' | 'range' | 'select' | 'daterange' | 'multiselect';
    filterLabel?: string;
    filterDescription?: string;
    rangeOptions?: {
      min: number | 'fromValues';
      max: number | 'fromValues';
      step?: number;
      marks?: Array<{ value: number; label: string }>;
    };
    selectOptions?: {
      options?: Array<{ label: string; value: string; color?: ColorPaletteProp }>;
      buildOptions?: (data: TData[]) => Array<{ label: string; value: string; color?: ColorPaletteProp }>;
      display?: 'chip' | 'select';
    };
    dateRangeOptions?: {
      min: string | 'fromValues';
      max: string | 'fromValues';
    };

    // This is a placeholder to utilize the type parameters and suppress unused type parameter warnings
    _ignoreUnusedTypeParameters?: { data?: TData; value?: TValue };
  }
}

type Props = {
  column: Column<any>;
};

export const Filter: React.FC<Props> = ({ column }) => {
  const { filterVariant } = column.columnDef.meta ?? {};

  switch (filterVariant) {
    case 'multiselect':
      return <MultiSelectFilter column={column} />;
    case 'select':
      return <SelectFilter column={column} />;
    case 'range':
      return <RangeFilter column={column} />;
    default:
      return null;
  }
};

export default Filter;
