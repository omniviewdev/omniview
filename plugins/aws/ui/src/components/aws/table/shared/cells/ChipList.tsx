import React from 'react';
import { Chip, Stack } from '@omniviewdev/base-ui';
import { chipStyle, toColor } from '../../../../shared/ui/colors';

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
    <Stack direction='row' spacing={1} style={{ flexWrap: 'nowrap', overflow: 'hidden' }}>
      {visible.map((val, i) => (
        <Chip key={i} size='sm' variant='solid' color={toColor(color)} style={chipStyle}>{val}</Chip>
      ))}
      {remaining > 0 && (
        <Chip size='sm' variant='outline' color='neutral' style={chipStyle}>{`+${remaining}`}</Chip>
      )}
    </Stack>
  );
};

export default ChipList;
