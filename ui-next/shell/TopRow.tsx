import { Icon, Text, type IconName } from '@omniviewdev/kit';
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
  return (
    <header className={styles.topRow} data-shell-region="topRow" aria-label="Window">
      <div className={styles.safeArea} data-shell-part="safeArea" aria-hidden="true">
        <span className={styles.dots}>
          <span className={styles.dot} />
          <span className={styles.dot} />
          <span className={styles.dot} />
        </span>
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
