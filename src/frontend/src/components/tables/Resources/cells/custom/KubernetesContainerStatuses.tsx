import React from 'react';

// material ui
import Chip from '@mui/joy/Chip';
import Grid from '@mui/joy/Grid';
import Sheet from '@mui/joy/Sheet';
import Tooltip from '@mui/joy/Tooltip';
import Typography from '@mui/joy/Typography';

// project imports
import Icon from '@/components/icons/Icon';
import { getStatus } from './utils';

// types
import {
  type ContainerStateTerminated,
  type ContainerStateWaiting,
  type ContainerStatus,
} from 'kubernetes-types/core/v1';
import ContainerStatusCard from './KubernetesContainerStatusCard';

// third party
import { formatRelative } from 'date-fns';

const KeyValuePairs = ({ message }) => {
  // Regex to find key=value pairs
  const regex = /(\w+)=(?:"([^"]*)"|(\S*))/g;
  const pairs = [];

  // Extract all matches from the message
  let match;
  while ((match = regex.exec(message)) !== null) {
    const key = match[1];
    const value = match[2] || match[3]; // Since the value can be in either capture group based on the presence of quotes
    pairs.push({ key, value });
  }

  return (
    <Sheet sx={{ p: 1, borderRadius: 'sm' }} variant='soft'>
      <Grid container>
        {pairs.map((pair, index) => (
          <React.Fragment key={index}>
            <Grid xs={2}>
              <Typography level="body-xs">{pair.key}</Typography>
            </Grid>
            <Grid xs={10}>
              <Typography level="body-xs">{pair.value}</Typography>
            </Grid>
          </React.Fragment>
        ))}
      </Grid>
    </Sheet>
  );
};

/**
 * Details on a why a container was terminated
 */
export const ContainerTerminatedStatusInfo: React.FC<{
  state: ContainerStateTerminated;
}> = ({ state }) => {
  const info = {
    'Exit Code': state.exitCode,
    Signal: state.signal,
    Reason: state.reason,
    Started: state.startedAt
      ? formatRelative(new Date(state.startedAt), new Date())
      : undefined,
    Finished: state.finishedAt
      ? formatRelative(new Date(state.finishedAt), new Date())
      : undefined,
  };

  return (
    <Grid container spacing={0}>
      {Object.entries(info).map(([key, value]) =>
        value ? (
          <React.Fragment key={key}>
            <Grid xs={6}>
              <Typography level="body-xs">{key}</Typography>
            </Grid>
            <Grid xs={6}>
              <Typography level="body-xs">{value}</Typography>
            </Grid>
          </React.Fragment>
        ) : null,
      )}
      {state.message && 
        <Grid xs={12}>
          <Chip size='sm' variant='outlined' sx={{ my: 1, borderRadius: 'sm' }}>Message</Chip>
          <KeyValuePairs message={state.message} />
        </Grid>
      }
    </Grid>
  );
};

/**
 * Details on why a container is waiting
 */
export const ContainerWaitingStatusInfo: React.FC<{
  state: ContainerStateWaiting;
}> = ({ state }) => {
  const info = {
    Reason: state.reason,
    Message: state.message,
  };

  return (
    <Grid container spacing={0}>
      {Object.entries(info).map(
        ([key, value]) =>
          value && (
            <React.Fragment key={key}>
              <Grid xs={6}>
                <Typography level="body-xs">{key}</Typography>
              </Grid>
              <Grid xs={6}>
                <Typography level="body-xs">{value}</Typography>
              </Grid>
            </React.Fragment>
          ),
      )}
    </Grid>
  );
};

export const ContainerStatusDecorator: React.FC<{
  status: ContainerStatus;
}> = ({ status }) => {
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

  return (
    <Tooltip
      key={statusInfo.text}
      placement="top-end"
      variant="soft"
      sx={{
        border: (theme) => `1px solid ${theme.palette.divider}`,
      }}
      title={<ContainerStatusCard status={status} />}
    >
      <Chip
        size="sm"
        sx={{
          borderRadius: 'sm',
          px: 1,
        }}
        color={statusInfo.color}
        variant={getVariant()}
        startDecorator={
          statusInfo.icon && <Icon name={statusInfo.icon} size={16} />
        }
      >
        {statusInfo.text}
      </Chip>
    </Tooltip>
  );
};
