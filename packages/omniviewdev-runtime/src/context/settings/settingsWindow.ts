import * as WindowClient from '../../bindings/github.com/omniviewdev/omniview/backend/window/service';
import { Events } from '@wailsio/runtime';

/** Migrates former extension-settings links to the workspace diagnostic tool. */
export function extensionInspectorTarget(path: string): string | null {
  const target = path.startsWith('#') ? path.slice(1) : path;
  if (!/^\/settings\/?(?:[?#]|$)/.test(target)) {
    return null;
  }
  const search = target.split('#', 1)[0].split('?')[1] ?? '';
  const params = new URLSearchParams(search);
  const section = params.get('section');
  if (section !== 'extensions'
    && !((section === null || section === 'core') && params.get('category') === 'extensions')) {
    return null;
  }
  const selection = new URLSearchParams();
  for (const key of ['plugin', 'point', 'contribution']) {
    const value = params.get(key);
    if (value) {
      selection.set(key, value);
    }
  }
  const query = selection.toString();
  return `/developer-tools/extensions${query ? `?${query}` : ''}`;
}

/** Returns a local settings route, without accepting external or look-alike URLs. */
export function settingsWindowTarget(path: string): string | null {
  const target = path.startsWith('#') ? path.slice(1) : path;
  return /^\/settings\/?(?:[?#]|$)/.test(target) && extensionInspectorTarget(target) === null ? target : null;
}

/** Opens Settings, or migrates former extension diagnostics into the main workspace. */
export function openSettings(target = ''): Promise<string> {
  const inspector = extensionInspectorTarget(target);
  if (inspector !== null) {
    return Events.Emit('extensions/inspector/open', { targetWindow: 'main', path: inspector })
      .then(() => WindowClient.Focus('main'))
      .then(() => 'main');
  }
  const route = target === '' ? '' : settingsWindowTarget(target);
  if (route === null) {
    return Promise.reject(new Error('Settings requires a local settings route.'));
  }
  // A bare Settings action keeps the retained window's current selection.
  return WindowClient.OpenSettings(route === '/settings' || route === '/settings/' ? '' : route);
}
