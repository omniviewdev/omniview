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
 * Navigates the active page of this window to a host route such as
 * `/settings?category=developer`. Code outside React (error actions, event
 * handlers) uses this instead of touching `window.location`.
 */
export function navigateActivePage(path: string): void {
  if (!activePageNavigator) {
    throw new Error(`cannot navigate to "${path}": this window has no page navigator`);
  }

  activePageNavigator(path);
}
