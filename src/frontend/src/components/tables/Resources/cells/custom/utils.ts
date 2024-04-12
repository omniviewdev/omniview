import { type ContainerStatus } from 'kubernetes-types/core/v1';

export type ContainerStatusInfo = {
  text: string;
  icon?: string;
  color: 'primary' | 'neutral' | 'warning' | 'success' | 'danger';
};

/**
 * Get the status information for the chip display
 */
export const getStatus = (status: ContainerStatus) => {
  if (status.state?.running) {
    return {
      text: 'Running',
      color: 'success',
    } as ContainerStatusInfo;
  } else if (status.state?.waiting) {
    return {
      text: 'Waiting',
      icon: 'LuTimer',
      color: 'warning',
    } as ContainerStatusInfo;
  } else if (
    status.state?.terminated &&
    status.state.terminated.reason === 'Completed'
  ) {
    return {
      text: 'Completed',
      icon: 'LuCheck',
      color: 'success',
    } as ContainerStatusInfo;
  } else if (status.state?.terminated) {
    return {
      text: 'Terminated',
      icon: 'LuError',
      color: 'danger',
    } as ContainerStatusInfo;
  } else {
    return {
      text: 'Unknown',
      color: 'neutral',
    } as ContainerStatusInfo;
  }
};
