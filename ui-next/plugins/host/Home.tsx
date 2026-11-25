import { Button, Icon, KindTile, RovingGroup, SearchField, Status, Text, menuTrigger, type IconName, type KindTileTone, type StatusRole } from '@omniviewdev/kit';
import { memo, useRef, useState, type KeyboardEvent } from 'react';
import type { ModifierEvent } from '../../shell';
import { scoreCandidate, wordsOf } from '../../shell/core/palette/match';
import styles from './Home.module.css';

// The Home page (HM1, HM2; ch16 S8, S9, S34), as far as the new window has a source and a destination for its parts: the plugins you can open in the main column and, in the side column, the connections used last (Recent) and the
// connections of every plugin. The mock's Home has more, "Needs attention", "Get started", recently closed tabs and a purpose line under each plugin; none of those has a source or a destination here, and a button that does nothing is a
// stub. Its "Connections in use" lists only the connections a tab is on that are connected or in trouble ("idle ones never show") and stops at six; this lists every connection a plugin has, because a person who cannot see their
// connections cannot open one, and the state on each row says which are connected.
//
// It draws what it is given: plain data in, what was chosen out. It reads no store and knows no plugin; the host makes the rows (`homeModel.ts`), owns the menu a row opens, and does what a choice means (`homePage.tsx`).
//
// WHAT IT COSTS (HM2), counted by `Home.test.tsx` and never by the clock: a page of 200 connections of one plugin is ONE render commit; a character typed in the field is at most TWO; and a store that changes one connection draws that
// connection's row and no other, because a row is `memo`ised on plain data that is the same object for as long as the connection is the same (`homeModel.ts` keeps it so) and on handlers that the host keeps the same. A row has no hook of its
// own and subscribes to nothing: it is a function of its props.

/** One plugin the page offers: what it is called, its glyph and colour, and a word when it cannot open to its page. */
export type HomeEntry = {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  readonly tone: KindTileTone;
  /** "Loading", "Did not load", "Stopped" or "Starting again": the plugin opens, to a page that says so (ch16 S65, degraded). Absent for a plugin that is ready. */
  readonly state: string | undefined;
};

/** One connection of a plugin, as a row: plain data, so that a row that has not changed is the same object and is not drawn again. */
export type HomeConnectionRow = {
  /** The identity of the record: its plugin and the plugin's key for it, made once and never drawn. The row's key in a list, and the context key of its menu (a record, not an element). */
  readonly id: string;
  readonly plugin: string;
  /** The plugin's id for the connection: what `onOpenConnection` hands back. Never drawn. */
  readonly key: string;
  /** What a person reads. */
  readonly name: string;
  /** The plugin's own secondary text for the connection (a provider, a region), one line. Absent: none. */
  readonly detail?: string | undefined;
  /** The plugin's glyph and colour: the tile the row wears. */
  readonly icon: IconName;
  readonly tone: KindTileTone;
  /** The state's role and the host's word for it: the glyph and the word of the kit's `Status`. */
  readonly role: StatusRole;
  readonly word: string;
  /** Why the last start failed, in one line the host made safe to show. It takes the second line from `detail`. Absent: nothing to say. */
  readonly reason?: string | undefined;
  /** A start is under way: the row says so, and is not started again. */
  readonly busy?: boolean | undefined;
};

/** The connections of one plugin. */
export type HomeConnectionGroup = {
  readonly plugin: string;
  /** The plugin's name: the label of the group while there are several. */
  readonly label: string;
  /** Whether the plugin's name stands over its rows: when more than one plugin has a connection, counted in the host's whole list and not in what a query left. */
  readonly named: boolean;
  readonly rows: readonly HomeConnectionRow[];
};

/** What the page tells a person who cannot see it, politely. A sentence told twice in a row has two serials, so that it is said twice. */
export type HomeAnnouncement = { readonly serial: number; readonly text: string };

export type HomeProps = {
  /** The plugins that can be opened, in the order to show them. */
  readonly entries: readonly HomeEntry[];
  /** The connections used last that still exist, most recent first, at most five: Recent. None: the section is not drawn. Each is drawn here and not again in `groups` (the host's rule: every connection once). */
  readonly recent: readonly HomeConnectionRow[];
  /** The other connections, grouped by plugin. None, with `connections` ready: the section is not drawn. */
  readonly groups: readonly HomeConnectionGroup[];
  /**
   * What the host knows of the connections: `loading` while it has not read them yet (the section says so, and is busy), `failed` when it could not (the section says so and offers a Retry); the rows, when there are any, stay.
   * `ready` otherwise.
   */
  readonly connections: 'loading' | 'ready' | 'failed';
  /** The window has no tab: the page says so under its title. Absent in a tab of its own. */
  readonly empty: boolean;
  /**
   * The menu a connection's row opens (the id `useMenu` gave the host's definition): each row is made a context trigger of it, keyed by its record, so a right click, the Menu key and Shift+F10 open it. Absent: the rows have none. The page
   * draws no menu and decides nothing of what is in it.
   */
  readonly menu?: string | undefined;
  /** What to say politely to a person who cannot see the page (the host's "Copied <name>"). Absent: nothing was said. */
  readonly announcement?: HomeAnnouncement | undefined;
  /** A plugin was chosen: its id, and the click or key that chose it (the open model reads its modifiers). */
  readonly onOpenPlugin: (id: string, event: ModifierEvent | undefined) => void;
  /** A connection was chosen, its plugin and its key, and the click or key that chose it. A failed one is chosen again the same way: that is its retry. The host keeps this function the same between renders, or every row is drawn again. */
  readonly onOpenConnection: (plugin: string, key: string, event: ModifierEvent | undefined) => void;
  /** The connections could not be read and the person asked again. */
  readonly onRetry: () => void;
};

/** With more rows than this, Recent and the connections together, the page has a field to narrow them by name: a short list is read, a long one is searched. */
const FILTER_ABOVE = 6;

const NO_WORDS: readonly string[] = [];
/** What a row that is given no menu is made a trigger by: nothing. */
const NO_TRIGGER = {};

/**
 * The rows whose name matches every word of the query, or failing that the plugin's secondary text under it (so that a region finds the connections of that region), best match first and equal matches in the order they came in.
 * The matcher and the ranking are the command palette's, so a name is found here as it is found there; the name weighs six times what the text under it does. Only the state and the reason are never matched: they are not what
 * a connection is called.
 */
function rank(rows: readonly HomeConnectionRow[], words: readonly string[]): HomeConnectionRow[] {
  const ranked: Array<{ readonly row: HomeConnectionRow; readonly score: number }> = [];
  for (const row of rows) {
    const score = scoreCandidate(words, { title: row.name, context: row.detail ?? '' });
    if (score !== undefined) {
      ranked.push({ row, score });
    }
  }

  // `sort` is stable: rows that match alike stay in the order the host gave them.
  ranked.sort((a, b) => b.score - a.score);
  return ranked.map(({ row }) => row);
}

/** The groups with only the rows a query keeps, the best match first; a group left with no row is gone. The rows are the objects the host gave, never copies. */
function narrow(groups: readonly HomeConnectionGroup[], words: readonly string[]): HomeConnectionGroup[] {
  return groups.flatMap((group): HomeConnectionGroup[] => {
    const rows = rank(group.rows, words);
    return rows.length === 0 ? [] : [{ ...group, rows }];
  });
}

type PluginsProps = {
  readonly entries: readonly HomeEntry[];
  readonly onOpen: HomeProps['onOpenPlugin'];
};

/** The plugins that can be opened: one native button each, in a roving list (one Tab stop, the arrows, Home and End move the focus). The state word, when there is one, follows the name. */
const Plugins = memo(function Plugins({ entries, onOpen }: PluginsProps) {
  return (
    <section className={styles.section} aria-label="Plugins you can open">
      <Text as="h2" variant="title">
        Plugins you can open
      </Text>
      <div className={styles.rows}>
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
      </div>
    </section>
  );
});

type RowProps = {
  readonly row: HomeConnectionRow;
  readonly menu: string | undefined;
  readonly onOpen: HomeProps['onOpenConnection'];
};

/**
 * One connection: ONE native button, never an interactive element inside another (the mock's `H.listrow`, core.js:1092): the plugin's tile, the name in the title weight with the plugin's secondary text under it in the muted caption (the
 * host's reason for the last failed start takes that line), and the state at the end. Both lines are one line and give way to the state, which never shrinks; a line that is cut says its whole text when it is pointed at (`data-ov-clip`).
 * The row is named by its text, the spaces between its parts standing where a flex container draws none. A start under way is `aria-busy`, and a press on it does nothing. With a menu it is a context trigger of it, by its record.
 *
 * It is `memo`ised, and it is a function of its props alone: no hook, no subscription. It is drawn again only when its row is another object, which the host makes it only when the connection changed, or when its handlers or menu changed.
 */
const ConnectionRow = memo(function ConnectionRow({ row, menu, onOpen }: RowProps) {
  const busy = row.busy === true;
  const secondary = row.reason !== undefined && row.reason !== '' ? row.reason : (row.detail ?? '');
  return (
    <button
      type="button"
      className={styles.row}
      aria-busy={busy ? 'true' : undefined}
      data-home-part="connection"
      data-home-plugin={row.plugin}
      {...(menu === undefined ? NO_TRIGGER : { ...menuTrigger(menu, row.id, 'context'), 'data-ov-menu-label': `${row.name} actions` })}
      onClick={(event) => {
        // A start under way is not started again: the row's state says so, in the host's words.
        if (!busy) {
          onOpen(row.plugin, row.key, event);
        }
      }}
    >
      <KindTile icon={row.icon} tone={row.tone} size={16} />
      <span className={styles.text}>
        <span className={styles.line} data-ov-clip="">
          <Text variant="title">{row.name}</Text>
        </span>
        {secondary === '' ? null : (
          <>
            {' '}
            <span className={styles.line} data-ov-clip="">
              <Text variant="caption" tone="muted">
                {secondary}
              </Text>
            </span>
          </>
        )}
      </span>{' '}
      <Status role={row.role}>{row.word}</Status>
    </button>
  );
});

type RowsProps = {
  /** The list's accessible name: what the rows are. */
  readonly label: string;
  readonly rows: readonly HomeConnectionRow[];
  readonly menu: string | undefined;
  readonly onOpen: HomeProps['onOpenConnection'];
};

/** A list of connection rows: one roving group, so one Tab stop whatever it holds. */
function Rows({ label, rows, menu, onOpen }: RowsProps) {
  return (
    <div className={styles.rows}>
      <RovingGroup label={label} kind="column" gap={2}>
        {rows.map((row) => (
          <ConnectionRow key={row.id} row={row} menu={menu} onOpen={onOpen} />
        ))}
      </RovingGroup>
    </div>
  );
}

type SideProps = Pick<HomeProps, 'recent' | 'groups' | 'menu' | 'onRetry'> & {
  readonly state: HomeProps['connections'];
  readonly onOpen: HomeProps['onOpenConnection'];
};

/**
 * The side column (the mock's `home__side`: Recent, then the connections): the field that narrows both by name at its top, when there are many; Recent, the connections used last; and the connections of every plugin, one block for
 * each plugin with the plugin's name over it when the host says to name them. The query is this component's: a character typed re-renders this column and nothing else of the page, and draws only the rows that come or go.
 */
function Side({ recent, groups, menu, state, onOpen, onRetry }: SideProps) {
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const total = recent.length + groups.reduce((sum, group) => sum + group.rows.length, 0);
  const searchable = total > FILTER_ABOVE;
  // The words of a query that cannot be typed (the field is gone) narrow nothing.
  const words = searchable ? wordsOf(query) : NO_WORDS;
  const narrowed = words.length > 0;
  const shownRecent = narrowed ? rank(recent, words) : recent;
  const shownGroups = narrowed ? narrow(groups, words) : groups;
  // A connections section stands over its rows, or over what it says of reading them: never over nothing.
  const showConnections = state !== 'ready' || shownGroups.length > 0;
  if (!searchable && recent.length === 0 && !showConnections) {
    return null;
  }

  // A printable character typed on a connection goes to the field, which is where it was meant to go: the focus moves there during the key's own event, so the browser enters the character in the field. Space is the row's own (it opens
  // it), a chord is somebody's shortcut, and a key that is not a character (an arrow, Enter, Tab) is the list's.
  const typeIntoField = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.key === ' ' || [...event.key].length !== 1) {
      return;
    }

    if (event.target instanceof Element && event.target.closest('[data-home-part="connection"]') !== null) {
      root.current?.querySelector<HTMLInputElement>('input[data-home-part="search"]')?.focus();
    }
  };

  return (
    <div ref={root} className={styles.side} data-home-part="side" onKeyDown={typeIntoField}>
      {searchable ? (
        <div className={styles.find}>
          <div className={styles.search}>
            <SearchField label="Search connections" value={query} onValueChange={setQuery} data-home-part="search" />
          </div>
          {/* Kept in the page while the field is, so that what a query finds, or does not, is said when it changes. */}
          <output className={styles.status}>
            {narrowed && shownRecent.length === 0 && shownGroups.length === 0 ? (
              <Text as="p" variant="caption" tone="muted">
                {`Nothing matches "${query.trim()}"`}
              </Text>
            ) : null}
          </output>
        </div>
      ) : null}
      {shownRecent.length === 0 ? null : (
        <section className={styles.section} aria-label="Recent">
          <Text as="h2" variant="title">
            Recent
          </Text>
          <Rows label="Recent connections" rows={shownRecent} menu={menu} onOpen={onOpen} />
        </section>
      )}
      {showConnections ? (
        <section className={styles.section} aria-label="Connections" aria-busy={state === 'loading' ? 'true' : undefined}>
          <Text as="h2" variant="title">
            Connections
          </Text>
          {state === 'loading' ? (
            <Text as="p" variant="caption" tone="muted">
              Reading connections…
            </Text>
          ) : null}
          {state === 'failed' ? (
            <>
              <Text as="p" variant="caption" tone="muted">
                Connections could not be read.
              </Text>
              <div className={styles.retry}>
                <Button
                  icon="rotate-cw"
                  onClick={() => {
                    onRetry();
                  }}
                >
                  Retry
                </Button>
              </div>
            </>
          ) : null}
          {shownGroups.length === 0 ? null : (
            <div className={styles.groups}>
              {shownGroups.map((group) => (
                <div key={group.plugin} className={styles.group}>
                  {group.named ? (
                    <Text as="h3" variant="caption" tone="muted">
                      {group.label}
                    </Text>
                  ) : null}
                  <Rows label={`${group.label} connections`} rows={group.rows} menu={menu} onOpen={onOpen} />
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

/**
 * The Home page: the title, a muted line when the window has no tab, and the mock's grid (`home__grid`): the plugins you can open in the main column and Recent and the connections in the side column. One column; from 760 px of the
 * page's own width, two. A page with no plugin draws no plugins section and a page with no connection to show draws no connections section, so no heading stands over nothing.
 */
export function Home({ entries, recent, groups, connections, empty, menu, announcement, onOpenPlugin, onOpenConnection, onRetry }: HomeProps) {
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
        {entries.length === 0 ? null : (
          <div className={styles.main} data-home-part="main">
            <Plugins entries={entries} onOpen={onOpenPlugin} />
          </div>
        )}
        <Side recent={recent} groups={groups} menu={menu} state={connections} onOpen={onOpenConnection} onRetry={onRetry} />
      </div>
      {/* The page's one live region: there from the first render and empty until something is told (one that appears with its text is not reliably announced). It carries `aria-live` and no role, so that a page that has a status of its own is found by that role; a sentence told twice in a row is two nodes. */}
      <div className={styles.said} aria-live="polite" aria-atomic="true" data-home-part="announcement">
        <span key={announcement?.serial}>{announcement?.text}</span>
      </div>
    </div>
  );
}
