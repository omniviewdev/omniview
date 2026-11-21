import { Icon, KindTile, Text, type IconName, type KindTileTone } from '@omniviewdev/kit';
import { failureWords } from '../loader/failure';
import styles from './NoTabs.module.css';
import type { PluginEntry } from './pluginStore';
import { DEFAULT_RAIL_ICON, railOf } from './rail';

// What the island shows when no tab is open and the plugins have settled: the mock's Home page, as far as its parts have a destination now (ch16 S8, amended by decision A17: the window
// is empty, not refilled, when the last tab closes, and it says where to go from here). The mock's Home has more: "Get started" (Search, Install plugins, Settings, a terminal), "Recent",
// "Connections in use" and a purpose line under each plugin. None of those has a destination or a source in the new window yet, and a button that does nothing is a stub.

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

type NoTabsProps = {
  readonly entries: readonly HomeEntry[];
  /** A plugin was chosen: its id. The host opens its home page in a tab. */
  readonly onOpen: (id: string) => void;
};

/**
 * The empty window: a heading, one line that says so, and the plugins that can be opened, each a button that opens the plugin's home page in a tab. It is a document the island scrolls.
 * Command W here closes the window on a Mac (`Shell`'s `onCloseWindow`), which the app menu's Close Window does too; on Windows and Linux the chord does nothing for now (a main window that hides has no way back there).
 */
export function NoTabs({ entries, onOpen }: NoTabsProps) {
  return (
    <div className={styles.home} data-shell-part="home">
      <Text as="h1" variant="heading">
        Home
      </Text>
      <Text as="p" tone="muted">
        No tabs are open.
      </Text>
      <section className={styles.section} aria-label="Plugins you can open">
        <Text as="h2" variant="title">
          Plugins you can open
        </Text>
        <ul className={styles.list}>
          {entries.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className={styles.row}
                onClick={() => {
                  onOpen(entry.id);
                }}
              >
                <KindTile icon={entry.icon} tone={entry.tone} />
                <Text variant="title">{entry.label}</Text>
                {entry.state === undefined ? null : (
                  <Text variant="caption" tone="muted">
                    {entry.state}
                  </Text>
                )}
                <Icon name="chevron-right" />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
