import React from 'react';
import { Button, Stack, Text } from '@omniviewdev/base-ui';
import { LuSearch, LuServerOff } from 'react-icons/lu';

type Props = {
  variant: 'no-connections' | 'no-results';
  onClearFilters?: () => void;
};

const rootStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 48,
  borderRadius: 4,
  border: '1px solid var(--ov-color-border-default)',
  gap: 16,
  minHeight: 200,
};

const bodyStyle: React.CSSProperties = { textAlign: 'center', maxWidth: 360 };

const EmptyState: React.FC<Props> = ({ variant, onClearFilters }) => (
  <div style={rootStyle}>
    {variant === 'no-connections' ? (
      <Stack align='center' spacing={3}>
        <LuServerOff size={40} opacity={0.4} />
        <Text weight="semibold" size="lg">No AWS Accounts Found</Text>
        <Text size="sm" style={bodyStyle}>
          No AWS profiles were detected. Configure AWS profiles in ~/.aws/config or plugin settings to get started.
        </Text>
      </Stack>
    ) : (
      <Stack align='center' spacing={3}>
        <LuSearch size={40} opacity={0.4} />
        <Text weight="semibold" size="lg">No Results</Text>
        <Text size="sm" style={bodyStyle}>
          No accounts match your current search or filters.
        </Text>
        {onClearFilters && (
          <Button variant='soft' color='neutral' size='sm' onClick={onClearFilters}>
            Clear Filters
          </Button>
        )}
      </Stack>
    )}
  </div>
);

export default EmptyState;
