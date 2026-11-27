import { useState, type ReactNode } from 'react';
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
  readonly scope: ReactNode;
};

/**
 * The window's top row: OS controls, Back and Forward, the tab strip and its drag lane, the active page's optional scope, and window actions.
 * Scope stays outside the tablist so each picker keeps its own Tab stop. Only contributed faces consume space.
 */
export function TopRow({ prefix, panelId, onNewTab, scope }: TopRowProps) {
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
      {scope}
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
