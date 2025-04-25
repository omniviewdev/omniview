import * as React from 'react';

// material-ui
import Card from '@mui/joy/Card';
import CardContent from '@mui/joy/CardContent';
import Divider from '@mui/joy/Divider';
import Stack from '@mui/joy/Stack';
import Typography from '@mui/joy/Typography';
import Chip from '@mui/joy/Chip';

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

  const getVariant = () => {
    switch (statusInfo.text) {
      case 'Completed':
        return 'outlined';
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
      variant="soft"
      sx={{
        p: 0.5,
        minWidth: 300,
        maxWidth: 800,
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent={'space-between'}
        spacing={2}
      >

        {showContainerName && <Typography level="body-sm">{status.name}</Typography>}
        <Stack gap={1} direction={'row'} alignItems={'center'}>
          <Chip
            size="sm"
            color={statusInfo.color}
            variant={getVariant()}
            sx={{ borderRadius: 'sm' }}
            startDecorator={
              statusInfo.icon && <Icon name={statusInfo.icon} size={16} />
            }
          >
            {statusInfo.text}
          </Chip>
          <Chip
            size="sm"
            color={status.ready ? 'primary' : 'warning'}
            variant={'outlined'}
            sx={{ borderRadius: 'sm' }}
          >
            {getStatusText()}
          </Chip>
        </Stack>
        {showStartedAt && status.state?.running?.startedAt && (
          <Typography level="body-sm">
            Started{' '}
            {formatRelative(
              new Date(status.state.running.startedAt),
              new Date(),
            )}
          </Typography>
        )}
      </Stack>
      <CardContent>
        <Stack direction="column" spacing={0}>
          {status.state?.terminated && (
            <ContainerTerminatedStatusInfo state={status.state.terminated} />
          )}
          {status.state?.waiting && (
            <ContainerWaitingStatusInfo state={status.state.waiting} />
          )}
          {status.state?.running && !status.lastState?.terminated && (
            <Typography level="body-sm" color="success">Container is healthy</Typography>
          )}
          {status.lastState?.terminated && (
            <Card variant="outlined" sx={{ px: 1, gap: 0.5, pb: 1, pt: 0.5 }}>
              <Stack
                direction="row"
                spacing={1}
                alignItems={'center'}
                justifyContent={'space-between'}
              >
                <Typography fontSize={12} textColor="neutral.50">
                  Last State
                </Typography>
                <Chip
                  size="sm"
                  color="danger"
                  variant="outlined"
                  sx={{ borderRadius: 'sm' }}
                >
                  Terminated
                </Chip>
              </Stack>
              <Divider inset="none" />
              <CardContent>
                <ContainerTerminatedStatusInfo
                  state={status.lastState.terminated}
                />
              </CardContent>
            </Card>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
};

export default ContainerStatusCard;
