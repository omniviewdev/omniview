import { IconButton } from '@omniviewdev/kit';
import { useEffect } from 'react';
import { platformOf } from '../../core/chords';
import { SettingsWindowShown } from '../context';
import type { PageMemory } from '../host';
import type { SettingsSession } from '../model/session';
import { Body } from './Body';
import styles from './WindowSurface.module.css';

export type WindowSurfaceProps = {
  readonly session: SettingsSession;
  readonly page: PageMemory;
  /** Hides the window: Close, Escape and the close chord. The window is kept, not destroyed (`HideSettings`). */
  readonly onClose: () => void;
  /** Counts up each time the host asks for a page: the body starts again on the page the memory names. */
  readonly request: number;
  /** False while the host has the window hidden: nothing is laid out or painted. */
  readonly visible: boolean;
};

/**
 * Settings as the content of its own window, the original application's: no shell around it (no rail, tabs or panel), a 41 px caption that moves the window and holds the title and Close, and the one `Body` under it. The window has
 * no operating-system controls (the host hides them: macOS keeps a hidden title bar, the others are frameless), so Close is drawn here; Escape and the close chord (Cmd+W, Ctrl+W) do the same, and a key that something in the page has
 * already used (an open picker, a field) is not taken from it. Closing hides the window and keeps this page (its drafts too, as the original did).
 */
export function WindowSurface({ session, page, onClose, request, visible }: WindowSurfaceProps) {
  useEffect(() => {
    // The shell's one place that tells a Mac from the rest: `navigator.platform` first. A WebKit that is not on a Mac can name a Macintosh in its user agent, and a chord that followed that one would be a key nobody presses.
    const mac = platformOf(navigator) === 'mac';
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) {
        return;
      }

      const chord = (mac ? event.metaKey : event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'w';
      if (chord || (event.key === 'Escape' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey)) {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <div className={styles.window} data-visible={visible} data-settings-part="window">
      <header className={styles.caption} data-settings-part="caption">
        <h1 className={styles.title}>Settings</h1>
        <IconButton icon="close" label="Close" variant="ghost" size="row" onClick={onClose} />
      </header>
      <div className={styles.body}>
        <SettingsWindowShown value={visible}>
          <Body key={request} session={session} page={page} headingLevel="h2" />
        </SettingsWindowShown>
      </div>
    </div>
  );
}
