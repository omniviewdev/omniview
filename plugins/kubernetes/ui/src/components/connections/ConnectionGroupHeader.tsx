import React from 'react';
import { Chip, Stack, Typography } from '@mui/joy';
import { LuChevronRight } from 'react-icons/lu';
import ProviderIcon from './ProviderIcon';

type Props = {
  label: string;
  count: number;
  provider?: string;
  isCollapsed: boolean;
  onToggle: () => void;
};

const ConnectionGroupHeader: React.FC<Props> = ({
  label,
  count,
  provider,
  isCollapsed,
  onToggle,
}) => (
  <Stack
    direction='row'
    alignItems='center'
    gap={1}
    onClick={onToggle}
    sx={{
      cursor: 'pointer',
      py: 0.75,
      px: 1,
      borderRadius: 'sm',
      '&:hover': { backgroundColor: 'background.level1' },
      userSelect: 'none',
    }}
  >
    <LuChevronRight
      size={16}
      style={{
        transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
        transition: 'transform 0.15s ease',
      }}
    />
    {provider && <ProviderIcon provider={provider} size={16} />}
    <Typography level='title-sm'>{label}</Typography>
    <Chip size='sm' variant='soft' color='neutral'>{count}</Chip>
  </Stack>
);

export default ConnectionGroupHeader;
