import type { HostConnections } from './connections';
import type { PluginSource } from './contributions';
import { HomeContent } from './homePage';
import styles from './NoTabs.module.css';

// What the island shows when no tab is open and the plugins have settled: the Home page (`homePage.tsx`, the same content the Home tab draws) with the line that says so (ch16 S8, amended by decision A17: the window is empty,
// not refilled, when the last tab closes, and it says where to go from here). What that page has and lacks against the mock's Home is written in `Home.tsx`; this file adds what is the empty window's own: its inset and the
// part the shell's probes read.

type NoTabsProps = {
  /** The window's plugin store: Home lists the plugins that can be opened and the connections of the ones that contribute. */
  readonly plugins: PluginSource;
  /** What the window knows of the connections and what choosing one does. Absent: the window has none, and no section is drawn for them. */
  readonly connections?: HostConnections | undefined;
  /** A plugin was chosen: its id. The host opens its home page in a tab. */
  readonly onOpen: (id: string) => void;
};

/**
 * The empty window: the Home page with a muted line that says no tab is open. Each plugin is a button that opens the plugin's home page in a tab, each connection one that opens the connection. It is a document the island scrolls.
 * Command W here closes the window on a Mac (`Shell`'s `onCloseWindow`), which the app menu's Close Window does too; on Windows and Linux the chord does nothing for now (a main window that hides has no way back there).
 */
export function NoTabs({ plugins, connections, onOpen }: NoTabsProps) {
  return (
    <div className={styles.window} data-shell-part="home">
      <HomeContent
        empty
        plugins={plugins}
        connections={connections}
        onOpenPlugin={(id) => {
          onOpen(id);
        }}
      />
    </div>
  );
}
