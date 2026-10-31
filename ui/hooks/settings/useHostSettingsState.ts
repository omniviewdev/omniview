import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Events } from '@wailsio/runtime';
import { HostProfiling, SettingsProvider } from '@omniviewdev/runtime/api';

export type HostSettingState = { requiresRestart: boolean; pendingRestart: boolean };
export type HostSettingStates = Record<string, HostSettingState | undefined>;

// Cancel in-flight reads before fetching external writes, including the root list.
export function useSettingsChanges() {
  const client = useQueryClient();
  useEffect(() => Events.On('settings/changed', () => {
    void client.cancelQueries({ queryKey: ['settings'] }).then(async () => (
      client.invalidateQueries({ queryKey: ['settings'] })
    ));
  }), [client]);
}

export function useHostSettingStates() {
  useSettingsChanges();
  return useQuery({
    queryKey: ['settings', 'restart-state'],
    queryFn: async ({ signal }) => {
      signal.throwIfAborted();
      return SettingsProvider.GetSettingStates();
    },
  });
}

export function useHostProfilingStatus(enabled: boolean) {
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  useEffect(() => {
    const update = () => {
      setVisible(document.visibilityState !== 'hidden'); 
    };

    document.addEventListener('visibilitychange', update);
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
    enabled: enabled && visible,
    refetchInterval: enabled && visible ? 5000 : false,
    refetchIntervalInBackground: false,
  });
}
