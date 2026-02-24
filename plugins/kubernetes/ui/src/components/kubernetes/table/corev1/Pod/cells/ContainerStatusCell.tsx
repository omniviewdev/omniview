import React from 'react'

// material-ui
import { Stack } from '@omniviewdev/ui/layout';

import { ContainerStatus } from "kubernetes-types/core/v1";
import { useTheme } from '@mui/material/styles';

type Props = {
  data?: Array<object>
}

export const ContainerStatusCell: React.FC<Props> = ({ data }) => {
  const theme = useTheme();

  if (!data || !Array.isArray(data)) {
    return <React.Fragment />;
  }

  const obj = data as Array<ContainerStatus>


  /** Get the color for the chip based on the status */
  const getColor = (status: ContainerStatus) => {
    if (status.ready) {
      return theme.palette.success.main
    }

    if (status.state?.waiting) {
      return theme.palette.warning.main
    }

    if (status.state?.terminated) {
      if (status.state.terminated.exitCode === 0) {
        return theme.palette.grey[800];
      }

      return theme.palette.error.main
    }

    if (status.state?.running) {
      // If the container is running, but not ready, it's still a warning
      // because it's not ready to serve traffic
      return theme.palette.warning.main
    }

    return theme.palette.grey[600];
  };


  return (
    <Stack
      direction="row"
      width={"100%"}
      alignItems={'center'}
      justifyContent={'flex-start'}
      spacing={1}
    >
      {obj.map((status, idx) => (
        <div
          key={idx}
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
      ))}
    </Stack>
  )
}

export default ContainerStatusCell;
