import { Icon, tip } from '@omniviewdev/kit';
import { useState } from 'react';
import { platformOf } from '../core/chords';
import { settingsChordKeys, settingsChordText } from './chords';
import { useSettings } from './context';
import styles from './Gear.module.css';

/**
 * The top row's Settings control (ch16 S6, the Window actions: Settings `⌘,`; the mock's `#topbar-settings`): a 20 px glyph in a 30 px face, a button and a Tab stop (decision A14), named Settings, with its chord as
 * `aria-keyshortcuts` and in its tip. It takes the focus when it is pressed (Safari does not focus a button it was clicked on), so the element the sheet gives the focus back to when it closes is this one. Kit part it should become:
 * the window actions' button, with the Search control. The glyph is the kit's `settings-2` until the kit has the mock's gear (`settings`, Lucide `LuSettings`): see the README, "Glyphs the icons step needs".
 */
export function Gear() {
  const control = useSettings();
  const [platform] = useState(() => platformOf(navigator));
  const chord = settingsChordText(platform);
  return (
    <button
      type="button"
      className={styles.gear}
      aria-label="Settings"
      aria-haspopup="dialog"
      aria-keyshortcuts={settingsChordKeys(platform)}
      data-shell-part="settings"
      {...tip(`Settings\n${chord}`)}
      onClick={(event) => {
        event.currentTarget.focus({ preventScroll: true });
        control.open();
      }}
    >
      <Icon name="settings-2" size={20} />
    </button>
  );
}
