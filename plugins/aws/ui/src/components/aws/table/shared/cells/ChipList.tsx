import React from 'react';
import { Stack } from '@omniviewdev/ui/layout';
import { Chip } from '@omniviewdev/ui';

type Props = {
  values: string[] | undefined;
  max?: number;
  color?: 'primary' | 'neutral' | 'success' | 'warning' | 'danger';
};

const ChipList: React.FC<Props> = ({ values, max = 3, color = 'neutral' }) => {
  if (!values || values.length === 0) return null;

  const visible = values.slice(0, max);
  const remaining = values.length - max;

  const chipColor = color === 'neutral' ? 'default' : color === 'danger' ? 'error' : color;

  return (
    <Stack direction='row' gap={0.5} flexWrap='nowrap' overflow='hidden'>
      {visible.map((val, i) => (
        <Chip key={i} size='sm' variant='filled' color={chipColor} label={val} sx={{ borderRadius: 1 }} />
      ))}
      {remaining > 0 && (
        <Chip size='sm' variant='outlined' color='default' label={`+${remaining}`} sx={{ borderRadius: 1 }} />
      )}
    </Stack>
  );
};

export default ChipList;
