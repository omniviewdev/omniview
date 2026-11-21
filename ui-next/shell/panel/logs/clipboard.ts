import styles from './LogsBody.module.css';

// Puts text on the clipboard from a button (the Logs toolbar's Copy), in the window the host runs in: the browser in server mode and the native window's web view. The asynchronous clipboard
// first, the way the product's other copy buttons do (an error's details, an activity record); where it is missing or refuses (no permission, an insecure context) the route the mock takes
// for a copy it has no permission for (shell-panel.js 1430-1443, PN-04): a readonly textarea, selected and copied with the document's command, out of sight and out of the way of the focus,
// which it gives back. The textarea keeps white space as it is, so the columns of a log are copied as they are.

/** The textarea that holds the text for the command: off screen, never in the tab order, not announced. */
function holder(text: string): HTMLTextAreaElement {
  const area = document.createElement('textarea');
  area.value = text;
  area.readOnly = true;
  area.tabIndex = -1;
  area.setAttribute('aria-hidden', 'true');
  area.className = styles.holder ?? '';
  return area;
}

/** The document's own command, on a selected textarea: true when it copied. Never throws. */
function viaCommand(text: string): boolean {
  if (typeof document.execCommand !== 'function') {
    return false;
  }

  const keep = document.activeElement;
  const area = holder(text);
  document.body.append(area);
  try {
    area.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
    if (keep instanceof HTMLElement && keep.isConnected) {
      keep.focus({ preventScroll: true });
    }
  }
}

/** Copies `text`; whether it did. A promise that never rejects: the caller tells the person what happened. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // No permission, an insecure context, or a clipboard that is not there (`navigator.clipboard` is undefined): the document's command is the other way.
  }

  return viaCommand(text);
}
