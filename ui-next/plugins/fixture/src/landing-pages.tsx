import { Button, CardGrid, DataView, KindTile, Link, Notice, PageHeader, ResourceCard, Stack, Status, Text, WorkspaceToolbar, useMenu, type DataTableColumn, type MenuItem, type StatusRole } from '@omniviewdev/kit';
import { useState, useSyncExternalStore } from 'react';
import type { ConnectionBusyV1, ConnectionV1, ConnectionVerbResultV1, ConnectionsHostV1, CustomPageContextV1, CustomPageV1 } from '../../contract/v1';
import { FILTERS, inFilter, isFilter } from './landing-navigator';

// The pages of the connections fixture's landing variant (KL2; `entry-landing.tsx`): two custom pages that are read in no connection, drawn whole from the kit. The landing is the page the host opens when the plugin is opened and no connection is named; it lists the plugin's
// connections as cards in the host's own words and opens one (`context.connections`, which is the window's store: nothing here reads the host or holds a list of its own). The second page, `all`, is the same connections as a table in a page that owns its scrolling
// (`layout: 'pane'`: a kit data view takes the height it is given), and the two link to each other with the kit's `Link`, which is how a page of a plugin goes to another of its own. The landing reads the parameter the navigator's entries open it with (KL5,
// `context.route.params.filter`, `landing-navigator.ts`) and lists the connections in that filter alone. The menu of a card offers the host's verbs on the connection (KL4: connect, check, disconnect and remove, which the host confirms itself), and the page says what each
// answered, in a notice: it holds no state of the connection of its own, and it leaves the choice of what is refused to the host.

export const PLUGIN_NAME = 'Seam Connections';

/** The tab of the landing, and the title of the page the link to it says. */
export const LANDING_TITLE = 'Landing';
export const ALL_TITLE = 'Connections';

/** What the page says while the window has not read the connections, when it could not, and when the plugin has none. */
export const READING_WORDS = 'Reading connections…';
export const FAILED_WORDS = 'The connections could not be read.';
export const NONE_WORDS = 'This plugin has no connections.';

/** The border of a card tells a connection in trouble from one that is not, and the word beside it says the same: a tone is never the only cue. */
const toneOf = (role: StatusRole): 'warning' | 'error' | undefined => (role === 'error' ? 'error' : role === 'attention' ? 'warning' : undefined);

/** What the card says while the host is doing something to the connection: the verb that holds it, over the state's word. */
const BUSY_WORDS: Readonly<Record<ConnectionBusyV1, string>> = { connecting: 'Connecting…', checking: 'Checking…', disconnecting: 'Disconnecting…', removing: 'Removing…' };

/** The verbs of `context.connections` that a card's menu offers, with the words of the item. */
const VERBS = [
  { verb: 'connect', label: 'Connect' },
  { verb: 'check', label: 'Check' },
  { verb: 'disconnect', label: 'Disconnect…' },
  { verb: 'remove', label: 'Remove…', destructive: true },
] as const;

/** What the page says of the answer a verb got: done, the person said no (nothing to report), or the host's sentence. */
type Answer = { readonly tone: 'success' | 'info' | 'warning'; readonly text: string };

function answerOf(verb: string, result: ConnectionVerbResultV1): Answer {
  if (result.ok) {
    return { tone: 'success', text: `${verb}: done.` };
  }

  return result.cancelled === true ? { tone: 'info', text: `${verb}: cancelled.` } : { tone: 'warning', text: `${verb}: ${result.reason}` };
}

/** The items of the menu a connection opens (right click, the Menu key, Shift+F10), for the connection whose key the host resolves. */
const itemsOf =
  (connections: ConnectionsHostV1, say: (answer: Answer) => void) =>
    (key: string | undefined): readonly MenuItem[] | undefined =>
      key === undefined
        ? undefined
        : [
          {
            kind: 'action',
            id: 'open',
            label: 'Open',
            onSelect: () => {
              void connections.open(key);
            },
          },
          {
            kind: 'action',
            id: 'open-new',
            label: 'Open in new tab',
            onSelect: () => {
              void connections.open(key, { newTab: true });
            },
          },
          { kind: 'separator', id: 'verbs' },
          ...VERBS.map(
            (entry): MenuItem => ({
              kind: 'action',
              id: entry.verb,
              label: entry.label,
              destructive: 'destructive' in entry,
              onSelect: () => {
                void connections[entry.verb](key).then((result) => {
                  say(answerOf(entry.verb, result));
                });
              },
            }),
          ),
        ];

function Landing({ context }: { readonly context: CustomPageContextV1 }) {
  const { connections } = context;
  const view = useSyncExternalStore(connections.subscribe, connections.getSnapshot);
  const [answer, setAnswer] = useState<Answer | undefined>(undefined);
  const asked = context.route.params.filter;
  const filter = isFilter(asked) ? asked : undefined;
  const shown = filter === undefined ? view.connections : view.connections.filter((connection) => inFilter(connection, filter));
  const menu = useMenu(itemsOf(connections, setAnswer));
  const refresh = () => {
    void connections.refresh();
  };

  return (
    <Stack gap={12}>
      <PageHeader
        title={PLUGIN_NAME}
        tile={{ icon: 'server', tone: 'blue' }}
        commands={{ utility: { id: 'refresh', label: 'Refresh connections', icon: 'refresh', onSelect: refresh } }}
      />
      {view.loaded ? null : (
        <Text as="p" tone="muted">
          {READING_WORDS}
        </Text>
      )}
      {answer === undefined ? null : (
        <Notice tone={answer.tone} live="status" data-landing-part="answer">
          {answer.text}
        </Notice>
      )}
      {view.failed ? (
        <Text as="p" tone="muted">
          {FAILED_WORDS}
        </Text>
      ) : null}
      {filter === undefined ? null : (
        <Text as="p" tone="muted">
          {`Showing: ${FILTERS[filter]}`}
        </Text>
      )}
      {view.loaded && !view.failed && view.connections.length === 0 ? (
        <Text as="p" tone="muted">
          {NONE_WORDS}
        </Text>
      ) : null}
      <CardGrid<ConnectionV1>
        label="Connections"
        items={shown}
        getKey={(connection) => connection.key}
        renderCard={(connection) => (
          <ResourceCard
            title={connection.name}
            lead={<KindTile icon="server" tone="blue" size={16} />}
            status={<Status role={connection.busy === undefined ? connection.role : 'progress'}>{connection.busy === undefined ? connection.word : BUSY_WORDS[connection.busy]}</Status>}
            metrics={Object.keys(connection.labels).length === 0 ? undefined : [{ label: 'Labels', value: Object.entries(connection.labels).map(([name, value]) => `${name}=${value}`).join(', ') }]}
            meta={connection.reason ?? connection.description}
            tone={toneOf(connection.role)}
            menu={{ id: menu, key: connection.key }}
            actions={
              <>
                <Button
                  size="row"
                  onClick={() => {
                    void connections.open(connection.key);
                  }}
                >
                  Open
                </Button>
                <Button
                  size="row"
                  variant="ghost"
                  onClick={() => {
                    void connections.open(connection.key, { newTab: true });
                  }}
                >
                  Open in new tab
                </Button>
              </>
            }
          />
        )}
      />
      <Link to={{ page: 'all' }}>All connections</Link>
    </Stack>
  );
}

function All({ context }: { readonly context: CustomPageContextV1 }) {
  const { connections } = context;
  const view = useSyncExternalStore(connections.subscribe, connections.getSnapshot);
  const open = (key: string) => {
    void connections.open(key);
  };

  const columns: ReadonlyArray<DataTableColumn<ConnectionV1>> = [
    {
      id: 'name',
      header: 'Name',
      fit: 'flex',
      width: 160,
      text: (row) => row.name,
      cell: (row) => (
        <Button
          variant="ghost"
          size="row"
          onClick={() => {
            open(row.key);
          }}
        >
          {row.name}
        </Button>
      ),
    },
    { id: 'state', header: 'State', fit: 'fixed', width: 160, text: (row) => row.word, cell: (row) => <Status role={row.role}>{row.word}</Status> },
    { id: 'description', header: 'Description', fit: 'flex', width: 200, text: (row) => row.description ?? '', cell: (row) => <Text tone="muted">{row.description ?? ''}</Text> },
  ];
  return (
    <DataView<ConnectionV1>
      label={ALL_TITLE}
      header={<PageHeader title={ALL_TITLE} tile={{ icon: 'server', tone: 'blue' }} />}
      toolbar={
        <WorkspaceToolbar label="Connections tools">
          <Link to={{ page: 'landing' }}>Back to the landing</Link>
        </WorkspaceToolbar>
      }
      table={{ rows: view.connections, getRowKey: (row) => row.key, columns, lines: 1, rowsAreImmutable: true }}
      footer={{ shown: view.connections.length, total: { kind: 'exact', value: view.connections.length }, noun: 'Connection', plural: 'Connections' }}
      state={view.loaded ? (view.connections.length === 0 ? { kind: 'empty' } : { kind: 'ready' }) : { kind: 'loading' }}
    />
  );
}

/** The landing: the page the host opens for the plugin when no connection is named. A document, as a page of a header and cards is. */
export const landingPage = { kind: 'custom', scope: 'plugin', title: LANDING_TITLE, icon: 'house', Body: Landing } satisfies CustomPageV1;

/** The plugin's connections as a table: a page of the plugin that owns its scrolling. */
export const allPage = { kind: 'custom', scope: 'plugin', title: ALL_TITLE, icon: 'server', layout: 'pane', Body: All } satisfies CustomPageV1;
