import React from 'react';
import { Sheet, Stack, Typography, Button } from '@mui/joy';
import { LuSearch, LuServerOff } from 'react-icons/lu';

type Props = {
  variant: 'no-connections' | 'no-results';
  onClearFilters?: () => void;
};

const EmptyState: React.FC<Props> = ({ variant, onClearFilters }) => (
  <Sheet
    variant='outlined'
    sx={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      p: 6,
      borderRadius: 'sm',
      gap: 2,
      minHeight: 200,
    }}
  >
    {variant === 'no-connections' ? (
      <Stack alignItems='center' gap={1.5}>
        <LuServerOff size={40} opacity={0.4} />
        <Typography level='title-lg'>No Clusters Found</Typography>
        <Typography level='body-sm' textAlign='center' sx={{ maxWidth: 360 }}>
          No kubeconfig contexts were detected. Add kubeconfig file paths in plugin settings to get started.
        </Typography>
      </Stack>
    ) : (
      <Stack alignItems='center' gap={1.5}>
        <LuSearch size={40} opacity={0.4} />
        <Typography level='title-lg'>No Results</Typography>
        <Typography level='body-sm' textAlign='center' sx={{ maxWidth: 360 }}>
          No clusters match your current search or filters.
        </Typography>
        {onClearFilters && (
          <Button
            variant='soft'
            color='neutral'
            size='sm'
            onClick={onClearFilters}
          >
            Clear Filters
          </Button>
        )}
      </Stack>
    )}
  </Sheet>
);

export default EmptyState;
