import { useId, useRef, type ReactNode } from 'react';
import type { ShellRegistration } from './registration';
import { ScopeLane } from './ScopeLane';
import styles from './Shell.module.css';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { TopRow } from './TopRow';
import { useRegionKeys } from './useRegionKeys';

export type ShellProps = {
  /** What the mounted screen tells the shell about itself. Plain data; the shell reads it and knows nothing of the plugin behind it. */
  readonly registration: ShellRegistration;
  /** The page, hosted in the island. */
  readonly children: ReactNode;
};

/**
 * The window frame of slice 1a (plan docs/ui-next/slices/1a-pods-list.md, PR 1a.5; ch16 §B): the top row with its one tab, the plugin frame
 * (the rail's track, the sidebar, the page island with the scope lane above its scroll owner) and the status bar. Regions are landmarks
 * with names, in reading order; F6 and Escape move between them. Every region is drawn from the registration in the first commit and
 * sized by CSS alone, so nothing measures and nothing shifts. State is in ./core and ./Tree; see README.md for the contract and the decisions.
 */
export function Shell({ registration, children }: ShellProps) {
  const { plugin, tab, path, rail, sidebar, scope } = registration;
  const ids = useId();
  const tabId = `${ids}-tab`;
  const panelId = `${ids}-panel`;
  const root = useRef<HTMLDivElement>(null);
  useRegionKeys(root);

  return (
    <div ref={root} className={styles.window} data-shell-part="window">
      <TopRow title={tab.title} icon={tab.icon} tabId={tabId} panelId={panelId} />
      <div className={styles.frame} data-shell-part="frame" data-rail={rail === undefined ? undefined : ''} data-sidebar={sidebar === undefined ? undefined : ''}>
        {rail === undefined ? null : <div className={styles.rail} data-shell-part="rail" aria-hidden="true" />}
        {sidebar === undefined ? null : <Sidebar sidebar={sidebar} />}
        <main className={styles.island} data-shell-region="island" data-shell-focus="" tabIndex={-1} aria-label={`${plugin.name} workspace`}>
          {scope === undefined || scope.length === 0 ? null : <ScopeLane label={`${plugin.name} scope`} faces={scope} />}
          <div id={panelId} className={styles.page} role="tabpanel" aria-labelledby={tabId} data-shell-part="page">
            <div className={styles.content}>{children}</div>
          </div>
        </main>
      </div>
      <StatusBar path={path} />
    </div>
  );
}
