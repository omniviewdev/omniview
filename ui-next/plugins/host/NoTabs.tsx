import type { IconName, KindTileTone } from '@omniviewdev/kit';
import { failureWords } from '../loader/failure';
import { Home, type HomeProps } from './Home';
import styles from './NoTabs.module.css';
import type { PluginEntry } from './pluginStore';
import { DEFAULT_RAIL_ICON, railOf } from './rail';

// What the island shows when no tab is open and the plugins have settled: the Home page (`Home.tsx`) with the line that says so (ch16 S8, amended by decision A17: the window is empty, not refilled, when the last tab closes, and it says
// where to go from here). What that page has and lacks against the mock's Home is written there; this file adds what is the empty window's own: the entries it lists (`homeEntriesOf`), its inset and the part the shell's probes read.

/** One plugin the empty window offers: what it is called, its glyph and colour, and a word when it cannot open to its page. */
export type HomeEntry = {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  readonly tone: KindTileTone;
  /** "Loading", "Did not load", "Stopped" or "Starting again": the plugin opens, to a page that says so (ch16 S65, degraded). Absent for a plugin that is ready. */
  readonly state: string | undefined;
};

/**
 * Every installed plugin, the ones that contribute first in the order of the rail, then the others by name: a plugin that is loading or did not load is still a place to go, because its
 * tab says what happened and offers the Retry, and it has no entry in the rail to reach it by.
 */
export function homeEntriesOf(entries: readonly PluginEntry[]): readonly HomeEntry[] {
  const ready = railOf(entries).map((entry): HomeEntry => ({ id: entry.id, label: entry.label, icon: entry.icon, tone: entry.accent ?? 'neutral', state: undefined }));
  const others = entries
    .filter((entry) => entry.phase !== 'ready')
    .map((entry): HomeEntry => ({ id: entry.id, label: entry.name, icon: DEFAULT_RAIL_ICON, tone: 'neutral', state: entry.phase === 'loading' ? 'Loading' : failureWords(entry.failure).caption }))
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : a.id < b.id ? -1 : 1));
  return [...ready, ...others];
}

/** What a window that is given no connections lists: none. */
const NO_GROUPS: HomeProps['groups'] = [];
/** What a window that is given no way to open one does with a choice. With no group there is no row to choose, so it is never called. */
const OPEN_NONE: HomeProps['onOpenConnection'] = () => undefined;

type NoTabsProps = {
  readonly entries: readonly HomeEntry[];
  /** A plugin was chosen: its id. The host opens its home page in a tab. */
  readonly onOpen: (id: string) => void;
  /** The connections of the plugins, grouped by plugin. Absent: none, and no section for them. */
  readonly groups?: HomeProps['groups'] | undefined;
  /** What the window knows of them. Absent: they are read, and `groups` is all there is. */
  readonly connections?: HomeProps['connections'] | undefined;
  /** A connection was chosen: its plugin and its key, and what chose it. Absent: nothing opens (with no group there is no row to choose). */
  readonly onOpenConnection?: HomeProps['onOpenConnection'] | undefined;
};

/**
 * The empty window: the Home page with a muted line that says no tab is open. Each plugin is a button that opens the plugin's home page in a tab, each connection one that opens the connection. It is a document the island scrolls.
 * Command W here closes the window on a Mac (`Shell`'s `onCloseWindow`), which the app menu's Close Window does too; on Windows and Linux the chord does nothing for now (a main window that hides has no way back there).
 */
export function NoTabs({ entries, onOpen, groups = NO_GROUPS, connections = 'ready', onOpenConnection = OPEN_NONE }: NoTabsProps) {
  return (
    <div className={styles.window} data-shell-part="home">
      <Home
        empty
        entries={entries}
        groups={groups}
        connections={connections}
        onOpenPlugin={(id) => {
          onOpen(id);
        }}
        onOpenConnection={onOpenConnection}
      />
    </div>
  );
}
