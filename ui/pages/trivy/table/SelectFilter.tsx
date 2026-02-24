/* eslint @typescript-eslint/consistent-type-definitions: 0 */
/* eslint @typescript-eslint/naming-convention: 0 */
import React from 'react';

import { Text } from '@omniviewdev/ui/typography';
import { Select } from '@omniviewdev/ui/inputs';
import { Chip } from '@omniviewdev/ui';

import {
  type Column,
} from '@tanstack/react-table';

type Props = {
  column: Column<any>;
};

export const SelectFilter: React.FC<Props> = ({ column }) => {
  const columnFilterValue = column.getFilterValue() as string;

  const options = React.useMemo(() => {
    return column.columnDef.meta?.selectOptions?.options
      ?? Array.from(column.getFacetedUniqueValues().keys())
        .sort()
        .slice(0, 5000)
        .map(o => ({ label: o, value: o, color: 'primary' }));
  }, [column.columnDef.meta, column.getFacetedUniqueValues()]);

  const handleChange = (e: any) => {
    const value = e.target.value as string | null;
    column.setFilterValue(value);
  };

  return (
    <Select
      value={columnFilterValue ?? ''}
      onChange={handleChange}
      options={[
        { value: '', label: 'All' },
        ...options.map(o => ({
          value: o.value,
          label: o.label,
        })),
      ]}
      sx={{
        minWidth: '20rem',
        pt: 0,
        pb: 0,
      }}
    />
  );
};

export default SelectFilter;
