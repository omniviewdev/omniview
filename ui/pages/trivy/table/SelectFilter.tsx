/* eslint @typescript-eslint/consistent-type-definitions: 0 */
/* eslint @typescript-eslint/naming-convention: 0 */
import React from 'react';

import Select from '@mui/joy/Select';
import Option from '@mui/joy/Option';
import Typography from '@mui/joy/Typography';

import {
  type Column,
} from '@tanstack/react-table';
import { Chip, type ColorPaletteProp } from '@mui/joy';

type Props = {
  column: Column<any>;
};

export const SelectFilter: React.FC<Props> = ({ column }) => {
  const columnFilterValue = column.getFilterValue() as string;
  const asChip = column.columnDef.meta?.selectOptions?.display === 'chip';

  const options = React.useMemo(() => {
    return column.columnDef.meta?.selectOptions?.options
      ?? Array.from(column.getFacetedUniqueValues().keys())
        .sort()
        .slice(0, 5000)
        .map(o => ({ label: o, value: o, color: 'primary' as ColorPaletteProp }));
  }, [column.columnDef.meta, column.getFacetedUniqueValues()]);

  // eslint-disable-next-line @typescript-eslint/ban-types
  const handleChange = (_: any, value: string | null) => {
    column.setFilterValue(value);
  };

  return (
    <Select
      value={columnFilterValue}
      onChange={handleChange}
      sx={{
        minWidth: '20rem',
        pt: 0,
        pb: 0,
      }}
      placeholder='All'
      slotProps={{
        listbox: {
          placement: 'bottom-end',
          sx: {
            '--ListDivider-gap': 0,
            width: '20rem',
            maxWidth: '20rem',
          },
        },
      }}
    >
      <Option value=''>All</Option>
      {options.map(o => (
        <Option key={o.value} value={o.value}>
          {asChip ? (
            <Chip
              variant="soft"
              size="sm"
              sx={{
                borderRadius: 'sm',
              }}
              color={o.color}
            >
              {o.label}
            </Chip>
          ) : (
            <Typography level='body-sm'>{o.label}</Typography>
          )}
        </Option>
      ))}
    </Select>
  );
};

export default SelectFilter;
