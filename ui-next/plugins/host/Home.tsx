import { Icon, KindTile, RovingGroup, SearchField, Status, Text, type IconName, type KindTileTone, type StatusRole } from '@omniviewdev/kit';
import { useState } from 'react';
import type { ModifierEvent } from '../../shell';
import { scoreCandidate, wordsOf } from '../../shell/core/palette/match';
import styles from './Home.module.css';
import type { HomeEntry } from './NoTabs';

// The Home page (HM1; ch16 S8, S9, S34), as far as the new window has a source and a destination for its parts: the plugins you can open, and the connections of every plugin. The mock's Home has more, "Needs attention", "Get started",
// "Recent" and a purpose line under each plugin; none of those has a source or a destination here yet, and a button that does nothing is a stub. Its "Connections in use" lists only the connections a tab is on that are connected or in
// trouble ("idle ones never show"); this lists every connection a plugin has, because a person who cannot see their connections cannot open one, and the state on each row says which are connected.
//
// It draws what it is given: plain data in, what was chosen out. It reads no store and knows no plugin; the host makes the rows (`homeModel.ts`) and does what a choice means.

/** One connection of a plugin, as a row. */
export type HomeConnectionRow = {
  /** The plugin's id for the connection: what `onOpenConnection` hands back. Never drawn. */
  readonly key: string;
  /** What a person reads. */
  readonly name: string;
  /** The state's role and the host's word for it: the glyph and the word of the kit's `Status`. */
  readonly role: StatusRole;
  readonly word: string;
  /** Why the last start failed, in one line the host made safe to show. Absent: nothing to say. */
  readonly reason?: string | undefined;
  /** A start is under way: the row says so, and is not started again. */
  readonly busy?: boolean | undefined;
};

/** The connections of one plugin, under the plugin's glyph. */
export type HomeConnectionGroup = {
  readonly plugin: string;
  /** The plugin's name: the label of the group while there are several. */
  readonly label: string;
  readonly icon: IconName;
  readonly tone: KindTileTone;
  readonly rows: readonly HomeConnectionRow[];
};

export type HomeProps = {
  /** The plugins that can be opened, in the order to show them. */
  readonly entries: readonly HomeEntry[];
  /** The connections, grouped by plugin. None, with `connections` ready: the section is not drawn. */
  readonly groups: readonly HomeConnectionGroup[];
  /**
   * What the host knows of the connections: `loading` while it has not read them yet, `failed` when it could not, `ready` otherwise. The first two say so in a line under the section's title; the rows, when there are any, stay.
   */
  readonly connections: 'loading' | 'ready' | 'failed';
  /** The window has no tab: the page says so under its title. Absent in a tab of its own. */
  readonly empty: boolean;
  /** A plugin was chosen: its id, and the click or key that chose it (the open model reads its modifiers). */
  readonly onOpenPlugin: (id: string, event: ModifierEvent | undefined) => void;
  /** A connection was chosen, its plugin and its key, and the click or key that chose it. A failed one is chosen again the same way: that is its retry. */
  readonly onOpenConnection: (plugin: string, key: string, event: ModifierEvent | undefined) => void;
};

/** With more rows than this the connections have a field to narrow them by name: a short list is read, a long one is searched. */
const FILTER_ABOVE = 6;

/**
 * The rows of each group whose name matches every word of the query, best match first and equal matches in the order they came in; a group left with no row is gone. The matcher and the ranking are the command palette's, so a name is
 * found here as it is found there.
 */
function narrow(groups: readonly HomeConnectionGroup[], words: readonly string[]): HomeConnectionGroup[] {
  const kept: HomeConnectionGroup[] = [];
  for (const group of groups) {
    const ranked: Array<{ readonly row: HomeConnectionRow; readonly score: number }> = [];
    for (const row of group.rows) {
      const score = scoreCandidate(words, { title: row.name });
      if (score !== undefined) {
        ranked.push({ row, score });
      }
    }

    if (ranked.length > 0) {
      // `sort` is stable: rows that match alike stay in the order the host gave them.
      ranked.sort((a, b) => b.score - a.score);
      kept.push({ ...group, rows: ranked.map(({ row }) => row) });
    }
  }

  return kept;
}

type PluginsProps = {
  readonly entries: readonly HomeEntry[];
  readonly onOpen: HomeProps['onOpenPlugin'];
};

/** The plugins that can be opened: one native button each, in a roving list (one Tab stop, the arrows, Home and End move the focus). The state word, when there is one, follows the name. */
function Plugins({ entries, onOpen }: PluginsProps) {
  return (
    <section className={styles.section} aria-label="Plugins you can open">
      <Text as="h2" variant="title">
        Plugins you can open
      </Text>
      <RovingGroup label="Plugins you can open" kind="column" gap={2}>
        {entries.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={styles.row}
            data-home-part="plugin"
            onClick={(event) => {
              onOpen(entry.id, event);
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
        ))}
      </RovingGroup>
    </section>
  );
}

type RowProps = {
  readonly group: HomeConnectionGroup;
  readonly row: HomeConnectionRow;
  readonly onOpen: HomeProps['onOpenConnection'];
};

/**
 * One connection: the plugin's glyph, the name, the reason the last start failed under it when there is one, and the state at the end. The name and the reason are one line each and give way to the state; a line that is cut says
 * its whole text when it is pointed at (`data-ov-clip`). The row is named by its text, the spaces between its parts standing where a flex container draws none.
 */
function ConnectionRow({ group, row, onOpen }: RowProps) {
  const busy = row.busy === true;
  const reason = row.reason ?? '';
  return (
    <button
      type="button"
      className={styles.row}
      aria-busy={busy ? 'true' : undefined}
      data-home-part="connection"
      data-home-plugin={group.plugin}
      onClick={(event) => {
        // A start under way is not started again: the row's state says so, in the host's words.
        if (!busy) {
          onOpen(group.plugin, row.key, event);
        }
      }}
    >
      <KindTile icon={group.icon} tone={group.tone} size={16} />
      <span className={styles.text}>
        <span className={styles.line} data-ov-clip="">
          <Text variant="title">{row.name}</Text>
        </span>
        {reason === '' ? null : (
          <>
            {' '}
            <span className={styles.line} data-ov-clip="">
              <Text variant="caption" tone="muted">
                {reason}
              </Text>
            </span>
          </>
        )}
      </span>{' '}
      <Status role={row.role}>{row.word}</Status>
    </button>
  );
}

type ConnectionsProps = {
  readonly groups: readonly HomeConnectionGroup[];
  readonly state: HomeProps['connections'];
  readonly onOpen: HomeProps['onOpenConnection'];
};

/** The connections of every plugin: one block for each plugin, with the plugin's name over it when there are several, and a field to narrow them by name when there are many. */
function Connections({ groups, state, onOpen }: ConnectionsProps) {
  const [query, setQuery] = useState('');
  const total = groups.reduce((sum, group) => sum + group.rows.length, 0);
  const searchable = total > FILTER_ABOVE;
  // The words of a query that cannot be typed (the field is gone) narrow nothing.
  const words = searchable ? wordsOf(query) : [];
  const shown = words.length === 0 ? groups : narrow(groups, words);
  // Whether the groups are named is the host's list, not the narrowed one: a name that came and went with each key would move the rows under the pointer.
  const named = groups.length > 1;

  return (
    <section className={styles.section} aria-label="Connections">
      <Text as="h2" variant="title">
        Connections
      </Text>
      {state === 'loading' ? (
        <Text as="p" variant="caption" tone="muted">
          Connections are loading.
        </Text>
      ) : null}
      {state === 'failed' ? (
        <Text as="p" variant="caption" tone="muted">
          Connections could not be read.
        </Text>
      ) : null}
      {searchable ? (
        <div className={styles.search}>
          <SearchField label="Search connections" value={query} onValueChange={setQuery} />
        </div>
      ) : null}
      {shown.length === 0 ? null : (
        <div className={styles.groups}>
          {shown.map((group) => (
            <div key={group.plugin} className={styles.group}>
              {named ? (
                <Text as="h3" variant="caption" tone="muted">
                  {group.label}
                </Text>
              ) : null}
              <RovingGroup label={`${group.label} connections`} kind="column" gap={2}>
                {group.rows.map((row) => (
                  <ConnectionRow key={row.key} group={group} row={row} onOpen={onOpen} />
                ))}
              </RovingGroup>
            </div>
          ))}
        </div>
      )}
      {/* Kept in the page while the field is, so that what a query finds, or does not, is said when it changes. */}
      {searchable ? (
        <output>
          {shown.length === 0 ? (
            <Text as="p" variant="caption" tone="muted">
              {`Nothing matches "${query.trim()}"`}
            </Text>
          ) : null}
        </output>
      ) : null}
    </section>
  );
}

/**
 * The Home page: the title, a muted line when the window has no tab, and two sections, the plugins you can open and the connections. One column; from 760 px of the page's own width, two (the plugins on the left, the connections on
 * the right), as the mock's `home__grid` does. A page with no plugin draws no plugins section and a page with no connection to show draws no connections section, so no heading stands over nothing.
 */
export function Home({ entries, groups, connections, empty, onOpenPlugin, onOpenConnection }: HomeProps) {
  return (
    <div className={styles.home}>
      <Text as="h1" variant="heading">
        Home
      </Text>
      {empty ? (
        <Text as="p" tone="muted">
          No tabs are open.
        </Text>
      ) : null}
      <div className={styles.grid}>
        {entries.length === 0 ? null : <Plugins entries={entries} onOpen={onOpenPlugin} />}
        {connections === 'ready' && groups.length === 0 ? null : <Connections groups={groups} state={connections} onOpen={onOpenConnection} />}
      </div>
    </div>
  );
}
