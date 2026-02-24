import React from 'react';
import { Chip } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
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
      py: 0.5,
      px: 0.75,
      borderRadius: 'var(--ov-radius-sm, 4px)',
      '&:hover': { bgcolor: 'var(--ov-bg-surface-hover, rgba(255,255,255,0.05))' },
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
    <Text weight='semibold' size='sm'>{label}</Text>
    <Chip size='sm' emphasis='soft' color='neutral' label={String(count)} />
  </Stack>
);

export default ConnectionGroupHeader;
