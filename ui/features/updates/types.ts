export const updateServiceName = 'main.UpdateService';

export const updateSettingsTarget = '/settings?section=core&category=updates';

/** Mirrors main.UpdateStatus. */
export type UpdateStatus = {
  state: string;
  version: string;
  availableVersion: string;
  error: string;
  channel: string;
  switchTarget: string;
  canceled: boolean;
  releaseUrl: string;
  lastCheckedAt: string;
  unsupportedReason: string;
};

/** Mirrors main.ActiveWork. */
export type ActiveWork = {
  kind: string;
  description: string;
};

/** Payload of the wails:updater:download-progress event. */
export type DownloadProgress = {
  written: number;
  total: number;
  rate: number;
};
