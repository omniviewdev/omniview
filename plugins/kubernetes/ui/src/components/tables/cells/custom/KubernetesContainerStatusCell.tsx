import React from 'react';

// @omniviewdev/ui
import { useTheme } from '@mui/material/styles';
import { Stack } from '@omniviewdev/ui/layout';
import { Tooltip } from '@omniviewdev/ui/overlays';

import { type ContainerStatus } from 'kubernetes-types/core/v1';
import ContainerStatusCard from './KubernetesContainerStatusCard';

type Props = {
  data?: unknown;
};

export const KubernetesContainerStatusCell: React.FC<Props> = ({ data }) => {
  const theme = useTheme();

  if (!data || !Array.isArray(data)) {
    return <React.Fragment />;
  }

  const obj = data as ContainerStatus[];

  const getColor = (status: ContainerStatus) => {
    if (status.ready) {
      return theme.palette.success.main;
    }

    if (status.state?.waiting) {
      return theme.palette.warning.main;
    }

    if (status.state?.terminated) {
      if (status.state.terminated.exitCode === 0) {
        return theme.palette.grey[800];
      }
      return theme.palette.error.main;
    }

    if (status.state?.running) {
      return theme.palette.warning.main;
    }

    return theme.palette.grey[600];
  };

  return (
    <Stack direction="row" sx={{ width: '100%' }} alignItems='center' justifyContent='flex-start' gap={1}>
      {obj.map((status) => (
        <Tooltip
          placement="top-end"
          content={<ContainerStatusCard status={status} showStartedAt={false} />}
        >
          <div
            color={getColor(status)}
            style={{
              backgroundColor: getColor(status),
              borderRadius: 2,
              width: 10,
              height: 10,
              maxWidth: 10,
              maxHeight: 10,
              minWidth: 10,
              minHeight: 10,
            }}
          />
        </Tooltip>
      ))}
    </Stack>
  );
};

export default KubernetesContainerStatusCell;
