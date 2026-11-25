import { useState } from 'react';
import { isNativeWindow } from './core/native';
import type { TabId } from './core/tabs';
import { useMaybePalette } from './palette/context';
import { Search } from './palette/Search';
import { useMaybeSettings } from './settings/context';
import { Gear } from './settings/Gear';
import { NavButtons } from './tabs/NavButtons';
import { TabStrip } from './tabs/TabStrip';
import styles from './TopRow.module.css';

type TopRowProps = {
  readonly prefix: string;
  readonly panelId: string;
  readonly onNewTab: ((after?: TabId) => void) | undefined;
};

/**
 * The window's top row (ch16 S4 to S6): the safe area for the OS window controls, Back and Forward, a drag gap, the tab strip, the drag lane, and the window actions. Of those Search and Settings are
 * built (Search is drawn when the shell has a palette and Settings when it has the control that opens it; the room of All tabs before them is kept empty, so each sits where the mock's does); with neither
 * the 138 px at the end are empty and hidden. The row has one geometry at every width and only the strip flexes. Not built: All tabs and Developer Tools, drag and the overflow menu. Kit
 * part it should become: the top row, around `TabStrip`.
 */
export function TopRow({ prefix, panelId, onNewTab }: TopRowProps) {
  const palette = useMaybePalette();
  const settings = useMaybeSettings();
  // The native window draws the real window controls in the safe area, and the 84 px stay theirs. A browser has none, so the shell draws three inert dots in
  // their place (the layout and the probes' reference are the same in both); beside the real controls they would peek out around them (N22b).
  const [native] = useState(isNativeWindow);
  return (
    <header className={styles.topRow} data-shell-region="topRow" aria-label="Window">
      <div className={styles.safeArea} data-shell-part="safeArea" aria-hidden="true">
        {native ? null : (
          <span className={styles.dots} data-shell-part="standIn">
            <span className={styles.dot} />
            <span className={styles.dot} />
            <span className={styles.dot} />
          </span>
        )}
      </div>
      <NavButtons />
      <div className={styles.gap} aria-hidden="true" />
      <div className={styles.tracks}>
        <TabStrip prefix={prefix} panelId={panelId} onNewTab={onNewTab} />
        <div className={styles.dragLane} data-shell-part="dragLane" />
      </div>
      {palette === null && settings === null ? (
        <div className={styles.actions} data-shell-part="actions" aria-hidden="true" />
      ) : (
        <div className={styles.actions} data-shell-part="actions" role="group" aria-label="Window actions">
          {palette === null ? null : <Search />}
          {settings === null ? null : <Gear />}
        </div>
      )}
    </header>
  );
}
