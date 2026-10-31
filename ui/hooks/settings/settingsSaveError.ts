// Host CommittedApplyError uses this fixed, user-safe message across Wails.
export const COMMITTED_SETTINGS_MESSAGE = 'Settings were saved but could not be applied. Restart Omniview to load the saved configuration.';

export function isCommittedSettingsError(error: unknown): boolean {
  const message = typeof error === 'string' ? error
    : error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
      ? error.message : '';
  return message.includes(COMMITTED_SETTINGS_MESSAGE);
}
