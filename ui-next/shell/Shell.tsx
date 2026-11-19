import { useId, useRef, useState, type ReactNode } from 'react';
import { platformOf } from './core/chords';
import type { ModifierEvent, TabsStore } from './core/tabs';
import { Panel } from './panel/Panel';
import { PanelProvider } from './panel/context';
import type { PanelBindings } from './panel/host';
import { SessionCards } from './panel/SessionCards';
import { usePanelChords } from './panel/usePanelChords';
import { Rail } from './Rail';
import type { ShellRegistration } from './registration';
import { ScopeLane } from './ScopeLane';
import styles from './Shell.module.css';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { TabsProvider } from './tabs/context';
import { PageHost, type PageTab } from './tabs/PageHost';
import { useTabChords } from './tabs/useTabChords';
import { TopRow } from './TopRow';
import { useRegionKeys } from './useRegionKeys';

export type ShellProps = {
  /** What the tab on screen's plugin says about its frame: the regions around the page. Plain data; the shell reads it and knows nothing of the plugin behind it. */
  readonly registration: ShellRegistration;
  /** The tab model: the strip, the status bar's path and the page host read it. The shell never writes to a tab but at a user's request (select, close, back, forward). */
  readonly tabs: TabsStore;
  /** Draws the page of one tab. Called for every tab the model keeps mounted, so a hidden page keeps its state. */
  readonly renderPage: (tab: PageTab) => ReactNode;
  /** What the island shows while no tab is on screen: the plugins are loading, or none is installed. */
  readonly empty: ReactNode;
  /**
   * An entry of the sidebar's tree was chosen (a click, Enter or Space on an entry, not a group): its id, and the click when it was one. The registration stays plain data and the shell
   * does not navigate: the host opens a tab through the model, and the page it shows registers with that entry as `current`, and only then is it selected.
   */
  readonly onChoose?: ((id: string, event: ModifierEvent | undefined) => void) | undefined;
  /**
   * An entry of the rail was chosen: its id. As with the tree, the shell does not switch anything itself: the host shows that entry's sidebar by registering it as `current`, and only then
   * is it selected. Choosing one closes no tab: tabs of several places stay open together.
   */
  readonly onSelectRail?: ((id: string) => void) | undefined;
  /** What the strip's new-tab control does. Absent: the strip draws none. */
  readonly onNewTab?: (() => void) | undefined;
  /**
   * Closes the window. Command or Control W closes the tab on screen; with no tab on screen there is nothing left for it to close, and on a Mac it asks for this (decision A17: an empty window
   * is never a trap). Elsewhere it asks for nothing: the main window hides when it closes, and only macOS can bring it back (the Dock icon). Absent where there is no window of the app's own to close, a browser tab: the chord then does nothing.
   */
  readonly onCloseWindow?: (() => void) | undefined;
  /**
   * The bottom panel: its model, and what draws the tools' bodies and the sessions' cards, which are the owners' and not the shell's (`panel/host.ts`). Absent: the window has no panel, no
   * splitter and no toggle, and the grid's panel row is 0 px.
   */
  readonly panel?: PanelBindings | undefined;
};

/**
 * The window frame (the slice plan, PR 1a.5; ch16 §B): the top row with the tab strip, the plugin frame (the rail's track, the sidebar, the page island with the scope lane above
 * its scroll owner) and the status bar. The island hosts the pages of the mounted tabs (S1b). Regions are landmarks with names, in reading order; F6 and Escape move between them.
 * Every region is drawn from the registration in the first commit and sized by CSS alone, so nothing measures and nothing shifts; a frame that is pending reserves the regions a
 * plugin's frame has. State is in ./core and ./Tree; see README.md for the contract and the decisions.
 */
export function Shell({ registration, tabs, renderPage, empty, onChoose, onSelectRail, onNewTab, onCloseWindow, panel }: ShellProps) {
  const { plugin, rail, sidebar, scope, layout = 'document', pending = false, held = false } = registration;
  const ids = useId();
  const prefix = `${ids}-tab`;
  const panelId = `${ids}-panel`;
  const root = useRef<HTMLDivElement>(null);
  const [platform] = useState(() => platformOf(navigator));
  useRegionKeys(root);
  usePanelChords(panel?.store);
  useTabChords(tabs, onCloseWindow);

  const hasRail = (rail !== undefined && rail.entries.length > 0) || pending || held;
  const hasSidebar = sidebar !== undefined || pending || held;
  const hasLane = (scope !== undefined && scope.length > 0) || pending;
  const content = (
    <TabsProvider store={tabs}>
      <div ref={root} className={styles.window} data-shell-part="window">
        <TopRow prefix={prefix} panelId={panelId} onNewTab={onNewTab} />
        <div className={styles.frame} data-shell-part="frame" data-rail={hasRail ? '' : undefined} data-sidebar={hasSidebar ? '' : undefined}>
          {hasRail ? <Rail rail={rail} onSelect={onSelectRail} /> : null}
          {hasSidebar ? <Sidebar sidebar={sidebar} owner={rail?.current} onChoose={onChoose} /> : null}
          <main className={styles.island} data-shell-region="island" data-shell-focus="" tabIndex={-1} aria-label={`${plugin.name} workspace`}>
            {hasLane ? <ScopeLane label={scope === undefined || scope.length === 0 ? undefined : `${plugin.name} scope`} faces={scope ?? []} /> : null}
            {/* A document page that scrolls is a tab stop of its own, as the tabs pattern asks of a panel that may hold no focusable content: a page of text
                scrolls from the keyboard. A pane scrolls nothing here: its own region is the stop. */}
            <PageHost renderPage={renderPage} empty={empty} layout={layout} prefix={prefix} panelId={panelId} />
          </main>
        </div>
        {panel === undefined ? null : <Panel platform={platform} />}
        <StatusBar platform={platform} />
      </div>
    </TabsProvider>
  );
  return panel === undefined ? (
    content
  ) : (
    <PanelProvider panel={panel}>
      {content}
      <SessionCards />
    </PanelProvider>
  );
}
