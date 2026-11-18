import { useState } from 'react';
import { isNativeWindow } from './core/native';
import { NavButtons } from './tabs/NavButtons';
import { TabStrip } from './tabs/TabStrip';
import styles from './TopRow.module.css';

type TopRowProps = {
  readonly prefix: string;
  readonly panelId: string;
  readonly onNewTab: (() => void) | undefined;
};

/**
 * The window's top row (ch16 S4 to S6): the safe area for the OS window controls, Back and Forward, a drag gap, the tab strip, the drag lane, and the room the window actions take later.
 * The row has one geometry at every width and only the strip flexes. Not built: All tabs, Search, Settings and Developer Tools (the 138 px at the end are theirs), the tab menu, drag and
 * the overflow menu. Kit part it should become: the top row, around `TabStrip`.
 */
export function TopRow({ prefix, panelId, onNewTab }: TopRowProps) {
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
      <div className={styles.actions} data-shell-part="actions" aria-hidden="true" />
    </header>
  );
}
