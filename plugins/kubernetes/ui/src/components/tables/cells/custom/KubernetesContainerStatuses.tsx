import React from 'react';

// @omniviewdev/ui
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import { Chip } from '@omniviewdev/ui';
import { Text } from '@omniviewdev/ui/typography';
import { Tooltip } from '@omniviewdev/ui/overlays';

// project imports
import Icon from '../../../shared/Icon';
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

const KeyValuePairs = ({ message }: { message: string }) => {
  const regex = /(\w+)=(?:"([^"]*)"|(\S*))/g;
  const pairs = [];

  let match;
  while ((match = regex.exec(message)) !== null) {
    const key = match[1];
    const value = match[2] || match[3];
    pairs.push({ key, value });
  }

  return (
    <Box sx={{ p: 1, borderRadius: 'sm', bgcolor: 'background.level1' }}>
      <Grid container>
        {pairs.map((pair, index) => (
          <React.Fragment key={index}>
            <Grid size={2}>
              <Text size="xs">{pair.key}</Text>
            </Grid>
            <Grid size={10}>
              <Text size="xs">{pair.value}</Text>
            </Grid>
          </React.Fragment>
        ))}
      </Grid>
    </Box>
  );
};

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
            <Grid size={6}>
              <Text size="xs">{key}</Text>
            </Grid>
            <Grid size={6}>
              <Text size="xs">{value}</Text>
            </Grid>
          </React.Fragment>
        ) : null,
      )}
      {state.message &&
        <Grid size={12}>
          <Chip size='sm' emphasis='outline' sx={{ my: 1, borderRadius: 'sm' }} label='Message' />
          <KeyValuePairs message={state.message} />
        </Grid>
      }
    </Grid>
  );
};

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
              <Grid size={6}>
                <Text size="xs">{key}</Text>
              </Grid>
              <Grid size={6}>
                <Text size="xs">{value}</Text>
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

  return (
    <Tooltip
      key={statusInfo.text}
      placement="top-end"
      content={<ContainerStatusCard status={status} />}
    >
      <Chip
        size="sm"
        sx={{
          borderRadius: 'sm',
          px: 1,
        }}
        color={statusInfo.color}
        emphasis={getEmphasis()}
        startAdornment={
          statusInfo.icon && <Icon name={statusInfo.icon} size={16} />
        }
        label={statusInfo.text}
      />
    </Tooltip>
  );
};
