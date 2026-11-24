import React from 'react';
import { Call, Events } from '@wailsio/runtime';
import { type DownloadProgress, type UpdateStatus, updateServiceName } from './types';

const pollIntervalMs = 2000;

/** Polls the update service and follows download progress events. */
export function useUpdateStatus(): { status?: UpdateStatus; error: string; progress?: DownloadProgress; refresh: () => Promise<void> } {
  const [status, setStatus] = React.useState<UpdateStatus>();
  const [error, setError] = React.useState('');
  const [progress, setProgress] = React.useState<DownloadProgress>();

  const refresh = React.useCallback(async () => {
    try {
      setStatus(await Call.ByName(`${updateServiceName}.Status`) as UpdateStatus);
      setError('');
    } catch (err) {
      setError(String(err));
    }
  }, []);

  React.useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, pollIntervalMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [refresh]);

  React.useEffect(() => {
    const offProgress = Events.On('wails:updater:download-progress', (event) => {
      setProgress(event.data as DownloadProgress);
    });
    return () => {
      offProgress();
    };
  }, []);

  const downloading = status?.state === 'downloading';
  React.useEffect(() => {
    if (!downloading) {
      setProgress(undefined);
    }
  }, [downloading]);

  return { status, error, progress: downloading ? progress : undefined, refresh };
}
