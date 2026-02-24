import React from 'react';
import Box from '@mui/material/Box';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { Button } from '@omniviewdev/ui/buttons';
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
      borderRadius: 1,
      border: '1px solid',
      borderColor: 'divider',
      gap: 2,
      minHeight: 200,
    }}
  >
    {variant === 'no-connections' ? (
      <Stack alignItems='center' gap={1.5}>
        <LuServerOff size={40} opacity={0.4} />
        <Text weight="semibold" size="lg">No AWS Accounts Found</Text>
        <Text size="sm" sx={{ textAlign: 'center', maxWidth: 360 }}>
          No AWS profiles were detected. Configure AWS profiles in ~/.aws/config or plugin settings to get started.
        </Text>
      </Stack>
    ) : (
      <Stack alignItems='center' gap={1.5}>
        <LuSearch size={40} opacity={0.4} />
        <Text weight="semibold" size="lg">No Results</Text>
        <Text size="sm" sx={{ textAlign: 'center', maxWidth: 360 }}>
          No accounts match your current search or filters.
        </Text>
        {onClearFilters && (
          <Button emphasis='soft' color='neutral' size='sm' onClick={onClearFilters}>
            Clear Filters
          </Button>
        )}
      </Stack>
    )}
  </Box>
);

export default EmptyState;
