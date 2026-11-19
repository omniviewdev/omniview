import { Icon, tip } from '@omniviewdev/kit';
import type { Platform } from './core/chords';
import { usePanel } from './panel/context';
import { togglePanel } from './panel/focus';
import { useOpen } from './panel/hooks';
import styles from './StatusBar.module.css';
import { toggleChordKeys, toggleChordText } from './panel/words';

/**
 * The status bar's panel toggle (ch16 S90, S91; the mock's `H.statusItem` with `id: 'panel'`): a 24 px target with a 16 px glyph, `aria-pressed` while the panel is open, named "Panel",
 * its chord in the tip and in `aria-keyshortcuts`. It is the first stop of the panel's keyboard path: Enter or Space opens the panel and moves the focus to its tool on screen. It reads
 * `open` and nothing else, so a session changing state does not render it.
 */
export function StatusToggle({ platform }: { readonly platform: Platform }) {
  const { store } = usePanel();
  const open = useOpen();
  return (
    <button
      type="button"
      className={styles.toggle}
      aria-label="Panel"
      aria-pressed={open}
      aria-keyshortcuts={toggleChordKeys(platform)}
      data-shell-part="panelToggle"
      {...tip(`Panel\n${toggleChordText(platform)}`)}
      onClick={() => {
        togglePanel(store);
      }}
    >
      <Icon name="panel-bottom" />
    </button>
  );
}
