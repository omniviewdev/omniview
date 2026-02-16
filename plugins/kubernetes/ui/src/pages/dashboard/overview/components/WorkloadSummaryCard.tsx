import React from 'react';
import {
  Box,
  Card,
  CardContent,
  CircularProgress,
  Stack,
  Typography,
} from '@mui/joy';

type StatusEntry = {
  label: string;
  count: number;
  color: 'success' | 'warning' | 'danger' | 'neutral';
};

type Props = {
  title: string;
  icon: React.ReactNode;
  total: number;
  statuses: StatusEntry[];
  loading?: boolean;
};

const WorkloadSummaryCard: React.FC<Props> = ({ title, icon, total, statuses, loading }) => {
  if (loading) {
    return (
      <Card variant='outlined' size='sm' sx={{ height: '100%' }}>
        <CardContent sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 80, py: 1 }}>
          <CircularProgress size='sm' />
        </CardContent>
      </Card>
    );
  }

  const visible = statuses.filter(s => s.count > 0);

  return (
    <Card variant='outlined' size='sm' sx={{ height: '100%' }}>
      <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
        <Stack direction='row' alignItems='center' gap={0.75} sx={{ mb: 0.5 }}>
          <Box sx={{ color: 'text.tertiary', display: 'flex' }}>{icon}</Box>
          <Typography level='title-sm'>{title}</Typography>
        </Stack>
        <Typography level='h3' sx={{ mb: 0.5 }}>{total}</Typography>
        <Stack gap={0.25}>
          {visible.map(s => (
            <Stack key={s.label} direction='row' alignItems='center' gap={0.75}>
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: `${s.color}.500`,
                  flexShrink: 0,
                }}
              />
              <Typography level='body-xs' sx={{ color: 'text.secondary' }}>
                {s.count} {s.label}
              </Typography>
            </Stack>
          ))}
          {visible.length === 0 && (
            <Typography level='body-xs' sx={{ color: 'text.tertiary', fontStyle: 'italic' }}>
              No active workloads
            </Typography>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
};

export default WorkloadSummaryCard;
