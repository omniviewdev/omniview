import React from 'react';
import { Chip, Stack } from '@mui/joy';

type Props = {
  values: string[] | undefined;
  max?: number;
  color?: 'primary' | 'neutral' | 'success' | 'warning' | 'danger';
};

const ChipList: React.FC<Props> = ({ values, max = 3, color = 'neutral' }) => {
  if (!values || values.length === 0) return null;

  const visible = values.slice(0, max);
  const remaining = values.length - max;

  return (
    <Stack direction='row' gap={0.5} flexWrap='nowrap' overflow='hidden'>
      {visible.map((val, i) => (
        <Chip key={i} size='sm' variant='soft' color={color} sx={{ borderRadius: 'sm' }}>
          {val}
        </Chip>
      ))}
      {remaining > 0 && (
        <Chip size='sm' variant='outlined' color='neutral' sx={{ borderRadius: 'sm' }}>
          +{remaining}
        </Chip>
      )}
    </Stack>
  );
};

export default ChipList;
