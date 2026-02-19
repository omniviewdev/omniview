import React from 'react';
import Box from '@mui/material/Box';
import { LuChartBar } from 'react-icons/lu';

import Skeleton from '../feedback/Skeleton';
import EmptyState from '../feedback/EmptyState';
import ErrorState from '../feedback/ErrorState';

interface ChartContainerProps {
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  empty?: boolean;
  width?: number | string;
  height: number;
  children: React.ReactNode;
}

export default function ChartContainer({
  loading,
  error,
  onRetry,
  empty,
  width,
  height,
  children,
}: ChartContainerProps) {
  if (loading) {
    return (
      <Box sx={{ width: width ?? '100%', height }}>
        <Skeleton variant="rectangular" width="100%" height={height} />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ width: width ?? '100%', height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <ErrorState message={error} onRetry={onRetry} variant="panel" />
      </Box>
    );
  }

  if (empty) {
    return (
      <Box sx={{ width: width ?? '100%', height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <EmptyState
          icon={<LuChartBar size={32} />}
          title="No data"
          description="There is no data to display."
          size="sm"
        />
      </Box>
    );
  }

  return <>{children}</>;
}
