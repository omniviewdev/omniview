import React from 'react';
import Box from '@mui/material/Box';
import { StatCard } from '@omniviewdev/ui';
import Skeleton from '@mui/material/Skeleton';

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
  onClick?: () => void;
};

/** Map status breakdown to a single accent color for the card value. */
function deriveColor(statuses: StatusEntry[]): 'primary' | 'warning' | 'danger' {
  const hasDanger = statuses.some(s => s.color === 'danger' && s.count > 0);
  const hasWarning = statuses.some(s => s.color === 'warning' && s.count > 0);
  if (hasDanger) return 'danger';
  if (hasWarning) return 'warning';
  return 'primary';
}

/** Build a compact description from the visible statuses. */
function deriveDescription(statuses: StatusEntry[]): string {
  const visible = statuses.filter(s => s.count > 0);
  if (visible.length === 0) return 'No active workloads';
  return visible.map(s => `${s.count} ${s.label}`).join(', ');
}

const WorkloadSummaryCard: React.FC<Props> = ({ title, icon, total, statuses, loading, onClick }) => {
  if (loading) {
    return <Skeleton variant="rounded" sx={{ borderRadius: 1, height: '100%', minHeight: 88 }} />;
  }

  const card = (
    <StatCard
      value={total}
      label={title}
      description={deriveDescription(statuses)}
      icon={icon}
      color={deriveColor(statuses)}
      sx={{ height: '100%' }}
    />
  );

  if (!onClick) return card;

  return (
    <Box
      onClick={onClick}
      sx={{
        cursor: 'pointer',
        height: '100%',
        borderRadius: 1,
        transition: 'box-shadow 0.15s',
        '&:hover > .MuiCard-root': {
          borderColor: 'var(--ov-accent-default)',
        },
      }}
    >
      {card}
    </Box>
  );
};

export default WorkloadSummaryCard;
