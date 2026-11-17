import { Icon, Text, type IconName } from '@omniviewdev/kit';
import { useState } from 'react';
import { isNativeWindow } from './core/native';
import styles from './TopRow.module.css';

type TopRowProps = {
  readonly title: string;
  readonly icon: IconName;
  readonly tabId: string;
  readonly panelId: string;
};

/**
 * The window's top row with the one tab of slice 1a: the safe area, the room the navigation group takes later, the tab strip, and the
 * drag lane. No close, no new-tab control and no overflow yet: there is no tab model to act on (plan 1.2). Kit part it should become: TabStrip.
 */
export function TopRow({ title, icon, tabId, panelId }: TopRowProps) {
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
      <div className={styles.reserved} />
      <div className={styles.strip} role="tablist" aria-label="Open tabs">
        <button type="button" role="tab" id={tabId} className={styles.tab} aria-selected="true" aria-controls={panelId} data-shell-focus="">
          <span className={styles.glyph}>
            <Icon name={icon} />
          </span>
          <span className={styles.title}>
            <Text>{title}</Text>
          </span>
        </button>
      </div>
      <div className={styles.dragLane} />
    </header>
  );
}
