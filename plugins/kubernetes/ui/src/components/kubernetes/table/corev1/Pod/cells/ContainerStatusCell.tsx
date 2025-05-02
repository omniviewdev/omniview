import React from 'react'

// material-ui
import {
  Stack,
  // Tooltip
} from '@mui/joy'

import { ContainerStatus } from "kubernetes-types/core/v1";
// import ContainerStatusCard from '../../../sidebar/Pod/ContainerStatusCard';
import { useTheme } from '@mui/joy';

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
      return theme.palette.success[400]
    }

    if (status.state?.waiting) {
      return theme.palette.warning[400]
    }

    if (status.state?.terminated) {
      if (status.state.terminated.exitCode === 0) {
        return theme.palette.neutral[800];
      }

      return theme.palette.danger[400]
    }

    if (status.state?.running) {
      // If the container is running, but not ready, it's still a warning
      // because it's not ready to serve traffic
      return theme.palette.warning[400]
    }

    return theme.palette.neutral[600];
  };


  return (
    <Stack
      direction="row"
      width={"100%"}
      alignItems={'center'}
      justifyContent={'flex-start'}
      spacing={1}
    >
      {obj.map((status) => (
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
      ))}
    </Stack>
  )
}

export default ContainerStatusCell;
