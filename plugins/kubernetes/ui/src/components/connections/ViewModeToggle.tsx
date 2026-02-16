import React from 'react';
import { IconButton, Stack } from '@mui/joy';
import { LuList, LuLayoutGrid } from 'react-icons/lu';
import type { ViewMode } from '../../types/clusters';

type Props = {
  value: ViewMode;
  onChange: (value: ViewMode) => void;
};

const ViewModeToggle: React.FC<Props> = ({ value, onChange }) => (
  <Stack direction='row' alignItems='center' gap={0.25}>
    <IconButton
      size='sm'
      variant={value === 'list' ? 'soft' : 'plain'}
      color={value === 'list' ? 'primary' : 'neutral'}
      onClick={() => onChange('list')}
    >
      <LuList size={18} />
    </IconButton>
    <IconButton
      size='sm'
      variant={value === 'grid' ? 'soft' : 'plain'}
      color={value === 'grid' ? 'primary' : 'neutral'}
      onClick={() => onChange('grid')}
    >
      <LuLayoutGrid size={18} />
    </IconButton>
  </Stack>
);

export default ViewModeToggle;
