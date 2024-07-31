
/* eslint @typescript-eslint/consistent-type-definitions: 0 */
/* eslint @typescript-eslint/naming-convention: 0 */
import React from 'react';

import Box from '@mui/joy/Box';
import Chip from '@mui/joy/Chip';
import Select from '@mui/joy/Select';
import Option from '@mui/joy/Option';
import Typography from '@mui/joy/Typography';
import { type ColorPaletteProp } from '@mui/joy';

import {
  type Column,
} from '@tanstack/react-table';

type Props = {
  column: Column<any>;
};

export const MultiSelectFilter: React.FC<Props> = ({ column }) => {
  const columnFilterValue = column.getFilterValue() as string[];
  const asChip = column.columnDef.meta?.selectOptions?.display === 'chip';

  const options = React.useMemo(() => {
    return column.columnDef.meta?.selectOptions?.options
      ?? Array.from(column.getFacetedUniqueValues().keys())
        .sort()
        .slice(0, 5000)
        .map(o => ({ label: o, value: o, color: 'primary' as ColorPaletteProp }));
  }, [column.columnDef.meta, column.getFacetedUniqueValues()]);

  const handleChange = (_: any, value: string[]) => {
    column.setFilterValue(value.length === 0 ? undefined : value);
  };

  return (
    <Select
      multiple
      value={columnFilterValue}
      onChange={handleChange}
      placeholder='All'
      renderValue={selected => (
        <Box sx={{ display: 'flex', gap: '0.25rem' }}>
          {selected.map(selectedOption => (
            <Chip
              variant='outlined'
              color='neutral'
              sx={{
                borderRadius: 2,
              }}
            >
              {selectedOption.label}
            </Chip>
          ))}
        </Box>
      )}
      sx={{
        minWidth: '20rem',
        pt: 0,
        pb: 0,
      }}
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
      {options.map(o => (
        <Option
          key={o.value}
          value={o.value}
        >

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

export default MultiSelectFilter;
