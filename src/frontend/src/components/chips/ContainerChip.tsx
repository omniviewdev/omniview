import { FC } from 'react';

// material-ui
import Chip from '@mui/joy/Chip';
import Tooltip from '@mui/joy/Tooltip';

// types
import { ContainerStatus } from 'kubernetes-types/core/v1';

type Props = {
  // /** The container to render for the chip */
  // container: Container;
  /** The status object of the container */
  status: ContainerStatus;
}

/**
* Display a chip for the container status
*/
const ContainerChip: FC<Props> = ({ status }) => {
  /** Get the color for the chip based on the status */
  const getColor = (status: ContainerStatus) => {
    if (status.ready) {
      return 'success';
    }
    if (status.state?.waiting) {
      return 'warning';
    }
    if (status.state?.terminated) {
      if (status.state.terminated.exitCode === 0) {
        return 'neutral';
      }
      return 'danger';
    }
    if (status.state?.running) {
      // if the container is running, but not ready, it's still a warning
      // because it's not ready to serve traffic
      return 'warning';
    }

    return 'neutral';
  }

  return (
    <Tooltip title={status.name} size='sm' variant="outlined" color="neutral" enterDelay={200} sx={{ p: 1 }} >
      <Chip
        size='sm'
        variant="solid"
        color={getColor(status)}
        sx={{ borderRadius: 2, width: 12, height: 12, maxWidth: 12, maxHeight: 12, minWidth: 12, minHeight: 12 }}
      />
    </Tooltip>
  );

}

export default ContainerChip;
