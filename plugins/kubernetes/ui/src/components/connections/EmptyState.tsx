import React from 'react';
import Box from '@mui/material/Box';
import { Button } from '@omniviewdev/ui/buttons';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { Heading } from '@omniviewdev/ui/typography';
import { LuSearch, LuServerOff } from 'react-icons/lu';

type Props = {
  variant: 'no-connections' | 'no-results';
  onClearFilters?: () => void;
};

const EmptyState: React.FC<Props> = ({ variant, onClearFilters }) => (
  <Box
    sx={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      p: 6,
      borderRadius: 'var(--ov-radius-md, 6px)',
      gap: 2,
      minHeight: 200,
      border: '1px solid var(--ov-border-default, rgba(255,255,255,0.08))',
      bgcolor: 'var(--ov-bg-surface, rgba(255,255,255,0.03))',
    }}
  >
    {variant === 'no-connections' ? (
      <Stack alignItems='center' gap={1.5}>
        <LuServerOff size={40} opacity={0.4} />
        <Heading level='h4'>No Clusters Found</Heading>
        <Text size='sm' sx={{ textAlign: 'center', maxWidth: 360 }}>
          No kubeconfig contexts were detected. Add kubeconfig file paths in plugin settings to get started.
        </Text>
      </Stack>
    ) : (
      <Stack alignItems='center' gap={1.5}>
        <LuSearch size={40} opacity={0.4} />
        <Heading level='h4'>No Results</Heading>
        <Text size='sm' sx={{ textAlign: 'center', maxWidth: 360 }}>
          No clusters match your current search or filters.
        </Text>
        {onClearFilters && (
          <Button
            emphasis='soft'
            color='neutral'
            size='sm'
            onClick={onClearFilters}
          >
            Clear Filters
          </Button>
        )}
      </Stack>
    )}
  </Box>
);

export default EmptyState;
