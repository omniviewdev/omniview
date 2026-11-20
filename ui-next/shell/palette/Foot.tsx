import type { Platform } from '../core/chords';
import type { PaletteState } from '../core/palette';
import styles from './Palette.module.css';
import { chordGlyphs, chordName } from './words';

// The footer (ch16 S70, A5): one muted line of the real keys of the active row, plain `kbd` text and no keycaps. A key that is not valid for the row is not shown; a command shows `Enter Run`;
// a row that cannot be used shows its reason in place of keys. What the last refusal said takes the line until the next change, because a live region alone leaves a sighted user with nothing.
// Kit part it should become: a key hint (`kbd`, the glyphs for the eye and the words for a screen reader) and the hints that hold it.

type FootProps = { readonly state: PaletteState; readonly platform: Platform };

export function Foot({ state, platform }: FootProps) {
  const active = state.rows[state.activeIndex];
  const reason = state.notice !== '' ? state.notice : state.view === 'results' && active?.availability.state === 'unavailable' ? active.availability.reason || 'Unavailable' : '';
  return (
    <div className={styles.foot} data-palette-part="foot">
      {reason === '' ? (
        <span className={styles.hints}>
          {state.hints.map((hint) => (
            <span key={hint.keys} className={styles.hint} data-palette-part="hint">
              <kbd className={styles.kbd}>
                <span aria-hidden="true">{chordGlyphs(hint.keys, platform)}</span>
                <span className={styles.hidden}>{chordName(hint.keys, platform)}</span>
              </kbd>
              <span>{hint.label}</span>
            </span>
          ))}
        </span>
      ) : (
        <span className={styles.reason}>{reason}</span>
      )}
    </div>
  );
}
