/* eslint @typescript-eslint/consistent-type-definitions: 0 */
/* eslint @typescript-eslint/naming-convention: 0 */
import React, { type SyntheticEvent } from 'react';

import Box from '@mui/joy/Box';
import Slider from '@mui/joy/Slider';

import { 
  type Column,
} from '@tanstack/react-table';

type Props = {
  column: Column<any>;
};

export const RangeFilter: React.FC<Props> = ({ column }) => {
  const [value, setValue] = React.useState(column.getFilterValue() ?? [0, 100]);

  const opts = column.columnDef.meta?.rangeOptions;
  const min = opts?.min === 'fromValues' ? Number(column.getFacetedMinMaxValues()?.[0] ?? '') : opts?.min;
  const max = opts?.max === 'fromValues' ? Number(column.getFacetedMinMaxValues()?.[1] ?? '') : opts?.max;

  const handleChange = (_: Event | SyntheticEvent, newValue: number | number[]) => {
    if (!Array.isArray(newValue)) {
      column.setFilterValue([min, newValue]);
      return;
    }

    column.setFilterValue([newValue[0] ?? min, newValue[1] ?? max]);
  };

  return (
    <Box px={2} pb={1}>
      <Slider
        onChangeCommitted={handleChange}
        onChange={(_, newValue) => {
          setValue(newValue as [number, number]); 
        }}
        value={value as [number, number]}
        valueLabelDisplay="auto"
        min={min}
        max={max}
        step={opts?.step ?? undefined}
        marks={opts?.marks ?? undefined}
      />
    </Box>
  );
};

export default RangeFilter;
