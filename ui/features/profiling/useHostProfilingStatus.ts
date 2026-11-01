import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HostProfiling } from '@omniviewdev/runtime/api';

export function useHostProfilingStatus() {
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  useEffect(() => {
    const update = () => {
      setVisible(document.visibilityState !== 'hidden');
    };

    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  return useQuery({
    queryKey: ['host-profiling', 'status'],
    queryFn: async ({ signal }) => {
      signal.throwIfAborted();
      return HostProfiling.GetStatus();
    },
    enabled: visible,
    refetchInterval: visible ? 5000 : false,
    refetchIntervalInBackground: false,
  });
}
