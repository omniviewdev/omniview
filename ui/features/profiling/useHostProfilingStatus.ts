import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HostProfiling, PluginManager } from '@omniviewdev/runtime/api';

function useWindowVisible() {
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
  return visible;
}

export function useHostProfilingStatus() {
  const visible = useWindowVisible();
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

export function usePluginProfilingStatuses() {
  const visible = useWindowVisible();
  return useQuery({
    queryKey: ['plugin-profiling', 'status'],
    gcTime: 0,
    queryFn: async ({ signal }) => {
      signal.throwIfAborted();
      return PluginManager.GetPluginProfilingStatuses();
    },
    enabled: visible,
    refetchInterval: visible ? 5000 : false,
    refetchIntervalInBackground: false,
  });
}
