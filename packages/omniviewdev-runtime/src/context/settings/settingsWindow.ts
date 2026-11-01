import * as WindowClient from '../../bindings/github.com/omniviewdev/omniview/backend/window/service';

/** Returns a local settings route, without accepting external or look-alike URLs. */
export function settingsWindowTarget(path: string): string | null {
  const target = path.startsWith('#') ? path.slice(1) : path;
  return /^\/settings\/?(?:[?#]|$)/.test(target) ? target : null;
}

/** Opens or focuses the application-owned Settings window without changing workspace pages. */
export function openSettings(target = ''): Promise<string> {
  const route = target === '' ? '' : settingsWindowTarget(target);
  if (route === null) {
    return Promise.reject(new Error('Settings requires a local settings route.'));
  }
  // A bare Settings action keeps the retained window's current selection.
  return WindowClient.OpenSettings(route === '/settings' || route === '/settings/' ? '' : route);
}
