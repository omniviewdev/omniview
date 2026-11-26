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
    return Call.ByName(`${updateServiceName}.Status`).then((value: unknown) => {
      setStatus(value as UpdateStatus);
      setError('');
    }).catch((err: unknown) => {
      setError(String(err));
    });
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
    // A new download starts from zero, not from the last download's progress.
    const offStarted = Events.On('wails:updater:download-started', () => {
      setProgress(undefined);
    });
    const offProgress = Events.On('wails:updater:download-progress', (event) => {
      setProgress(event.data as DownloadProgress);
    });
    return () => {
      offStarted();
      offProgress();
    };
  }, []);

  return { status, error, progress: status?.state === 'downloading' ? progress : undefined, refresh };
}
