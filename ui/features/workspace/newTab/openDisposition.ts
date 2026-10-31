import type { ActivePageNavigation } from '../activePageNavigation';

/** Where a new page opens. */
export type OpenDisposition = 'tab' | 'background' | 'window';

type Modifiers = { readonly shiftKey: boolean; readonly metaKey: boolean; readonly ctrlKey: boolean };

/**
 * Browser conventions for a click or Enter that opens a page: Cmd/Ctrl (or the
 * middle button) opens a background tab and adding Shift brings that tab to the
 * front; Shift alone opens a new window.
 */
export function dispositionFor(modifiers: Modifiers, middleButton = false): OpenDisposition {
  if (modifiers.metaKey || modifiers.ctrlKey || middleButton) {
    return modifiers.shiftKey ? 'tab' : 'background';
  }

  return modifiers.shiftKey ? 'window' : 'tab';
}

export function openPath(
  navigation: Pick<ActivePageNavigation, 'openInNewTab' | 'openInNewWindow'>,
  path: string,
  disposition: OpenDisposition,
): void {
  if (disposition === 'window') {
    navigation.openInNewWindow(path);
  } else {
    navigation.openInNewTab(path, { background: disposition === 'background' });
  }
}
