import * as React from 'react';

// @omniviewdev/ui
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import { Card, Chip } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';

// project imports
import Icon from '../../../shared/Icon';
import { getStatus } from './utils';

// types
import { type ContainerStatus } from 'kubernetes-types/core/v1';
import {
  ContainerTerminatedStatusInfo,
  ContainerWaitingStatusInfo,
} from './KubernetesContainerStatuses';

// third-party
import { formatRelative } from 'date-fns';

type Props = {
  status: ContainerStatus;
  showContainerName?: boolean;
  showStartedAt?: boolean;
};

const ContainerStatusCard: React.FC<Props> = ({
  status,
  showContainerName = true,
  showStartedAt = true,
}) => {
  const statusInfo = getStatus(status);

  const getEmphasis = () => {
    switch (statusInfo.text) {
      case 'Completed':
        return 'outline';
      case 'Waiting':
        return 'soft';
      default:
        return 'solid';
    }
  };

  const getStatusText = () => {
    if (status.ready && status.started) {
      return 'Ready';
    } else if (!status.ready && status.started) {
      return 'Started';
    }
    return 'Not Ready';
  };

  return (
    <Card
      sx={{
        p: 0.5,
        minWidth: 300,
        maxWidth: 800,
        bgcolor: 'background.level1',
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent='space-between'
        gap={2}
      >
        {showContainerName && <Text size='sm'>{status.name}</Text>}
        <Stack gap={1} direction='row' alignItems='center'>
          <Chip
            size="sm"
            color={statusInfo.color}
            emphasis={getEmphasis()}
            sx={{ borderRadius: 'sm' }}
            startAdornment={
              statusInfo.icon && <Icon name={statusInfo.icon} size={16} />
            }
            label={statusInfo.text}
          />
          <Chip
            size="sm"
            color={status.ready ? 'primary' : 'warning'}
            emphasis='outline'
            sx={{ borderRadius: 'sm' }}
            label={getStatusText()}
          />
        </Stack>
        {showStartedAt && status.state?.running?.startedAt && (
          <Text size='sm'>
            Started{' '}
            {formatRelative(
              new Date(status.state.running.startedAt),
              new Date(),
            )}
          </Text>
        )}
      </Stack>
      <Box sx={{ p: 0.5 }}>
        <Stack direction="column" gap={0}>
          {status.state?.terminated && (
            <ContainerTerminatedStatusInfo state={status.state.terminated} />
          )}
          {status.state?.waiting && (
            <ContainerWaitingStatusInfo state={status.state.waiting} />
          )}
          {status.state?.running && !status.lastState?.terminated && (
            <Text size='sm' sx={{ color: 'success.main' }}>Container is healthy</Text>
          )}
          {status.lastState?.terminated && (
            <Card variant="outlined" sx={{ px: 1, gap: 0.5, pb: 1, pt: 0.5 }}>
              <Stack
                direction="row"
                gap={1}
                alignItems='center'
                justifyContent='space-between'
              >
                <Text sx={{ fontSize: 12, color: 'neutral.50' }}>
                  Last State
                </Text>
                <Chip
                  size="sm"
                  color="danger"
                  emphasis="outline"
                  sx={{ borderRadius: 'sm' }}
                  label='Terminated'
                />
              </Stack>
              <Divider />
              <Box sx={{ p: 0.5 }}>
                <ContainerTerminatedStatusInfo
                  state={status.lastState.terminated}
                />
              </Box>
            </Card>
          )}
        </Stack>
      </Box>
    </Card>
  );
};

export default ContainerStatusCard;
