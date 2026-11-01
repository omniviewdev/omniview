import { openSettings, settingsWindowTarget } from '../settings/settingsWindow';

type ActivePageNavigator = (path: string) => void;

let activePageNavigator: ActivePageNavigator | null = null;

/**
 * The host registers how to navigate the page the user is looking at (the
 * active page tab of this window). Returns the unregister function.
 */
export function registerActivePageNavigator(navigator: ActivePageNavigator): () => void {
  activePageNavigator = navigator;
  return () => {
    if (activePageNavigator === navigator) {
      activePageNavigator = null;
    }
  };
}

/**
 * Navigates the active page, or activates the dedicated Settings window for
 * settings routes. Code outside React uses this instead of touching window.location.
 */
export function navigateActivePage(path: string): void {
  const settingsTarget = settingsWindowTarget(path);
  if (settingsTarget !== null) {
    void openSettings(settingsTarget).catch((error: unknown) => {
      console.error('[settings] opening the settings window failed', error);
    });
    return;
  }

  if (!activePageNavigator) {
    throw new Error(`cannot navigate to "${path}": this window has no page navigator`);
  }

  activePageNavigator(path);
}
