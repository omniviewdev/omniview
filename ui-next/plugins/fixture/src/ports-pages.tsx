import { Button, Stack, Text, type DataTableColumn } from '@omniviewdev/kit';
import { useMemo, useState } from 'react';
import type { ContextV1, FrameV1, ListPageV1, ListPageViewV1, ListSource, PanelHostV1, PortForwardSessionV1 } from '../../contract/v1';
import { connectionFace, useChosenConnection, type PageConnection } from './connection';
import {
  AGAIN_LABEL,
  FORWARD_LABEL,
  NO_CONNECTION_WORDS,
  NO_FORWARD_WORDS,
  NO_PORTS_WORDS,
  PENDING_WORDS,
  PORTS_NAME,
  STOP_LABEL,
  TARGET_ID,
  TARGET_PORT,
  forwardRequest,
  outcomeWords,
  refusalOf,
  type ForwardAction,
  type ForwardOutcome,
} from './ports';

// The page of the ports fixture (ports.ts says what the plugin is): one list with one row, the target, whose last cell holds the three buttons that ask the host to forward the target's port, to stop the forward it last answered
// and to forward the same port again, and says what became of the last call. The page is read in the plugin's one connection (connection.ts, as the connections fixture's page is) and asks through the handle the host gave
// it, `ctx.panel.ports`, which the host binds to this plugin and this connection: the request names neither. What the page says of a call is the host's answer or the host's refusal, by its code and in its words. A page
// that has no handle says why it has none: the host gives none to a page that is open in no connection, and an older host gives none at all. Its buttons stay where they are, with the reason on each and on the page.

type Ports = NonNullable<PanelHostV1['ports']>;

/** What a page can forward with, or why it cannot: the handle the host gave it, and otherwise the reason it has none. */
export type ForwardAccess =
  | { readonly kind: 'ready'; readonly ports: Ports }
  | { readonly kind: 'no-connection' }
  | { readonly kind: 'no-member' };

/**
 * What the page has to forward with: the member the host gave, whatever the page thinks of its own connection, because the host binds the handle and the page does not second-guess it. Without the member the page says why: the host
 * gives none to a page that is open in no connection (nothing says which connection to forward in), so a page with a connection and no member is on a host that has none.
 */
export function accessOf(ports: Ports | undefined, inConnection: boolean): ForwardAccess {
  if (ports !== undefined) {
    return { kind: 'ready', ports };
  }

  return { kind: inConnection ? 'no-member' : 'no-connection' };
}

const WHY_NOT = { 'no-connection': NO_CONNECTION_WORDS, 'no-member': NO_PORTS_WORDS } as const;

export type TargetRow = {
  /** The identity of the row in the list: the target's id. */
  readonly id: string;
  readonly name: string;
  /** The port of the target that is forwarded. */
  readonly port: number;
  /** What forwards, from the handle the host gave the page, or the reason the buttons cannot. */
  readonly access: ForwardAccess;
};

/** The rows of the page: the target, with what the page can forward with. */
export function targetsOf(access: ForwardAccess): readonly TargetRow[] {
  return [{ id: TARGET_ID, name: TARGET_ID, port: TARGET_PORT, access }];
}

const TITLE = 'Targets';

/** How the page sits in the frame: the tab, the status bar's path and the scope lane. */
export function targetsFrame(connection: Pick<PageConnection, 'named' | 'pending'>): FrameV1 {
  const { named } = connection;
  return {
    tab: { title: TITLE, icon: 'box' },
    path: named === undefined ? [PORTS_NAME, TITLE] : [PORTS_NAME, named, TITLE],
    scope: [connectionFace(connection)],
  };
}

const NOT_IN_A_CONNECTION: Pick<PageConnection, 'named' | 'pending'> = { named: undefined, pending: false };

/**
 * The connection the frame says. The plugin chooses the first of its connections for a route that names none (connection.ts), which a page open in no connection must not say: the host gave it no handle for that very
 * reason, and a lane that said `harbor` beside words that say the page is open in none would contradict itself.
 */
export function frameConnectionOf(route: string | undefined, chosen: Pick<PageConnection, 'named' | 'pending'>): Pick<PageConnection, 'named' | 'pending'> {
  return route === undefined ? NOT_IN_A_CONNECTION : chosen;
}

const START_FALLBACK = 'The host could not start the forward.';
const STOP_FALLBACK = 'The host could not stop the forward.';

/**
 * The three buttons and what the page says of them. It keeps the answer the host gave LAST (a forward it started), which the second button stops and the third asks for the port of; a refusal leaves it as it was, and a stop does not
 * clear it (the host answers a stop for a forward it no longer has too, so a press after it is the contract's second call, and the same port can be asked for again once it is free). One call is under way at a time: the button that was
 * pressed is busy, and each of the others says why it waits (`PENDING_WORDS`), so that no button is drawn that a press does nothing on. What became of the last call is said in a status the page has from the start, so that it is read out
 * when it arrives, and the next call takes its place. A refusal is said by the class the host gave it and in the words it gave.
 */
export function ForwardControl({ access }: { readonly access: ForwardAccess }) {
  const [outcome, setOutcome] = useState<ForwardOutcome>({ kind: 'idle' });
  const [last, setLast] = useState<PortForwardSessionV1 | undefined>(undefined);
  const pending: ForwardAction | undefined = outcome.kind === 'pending' ? outcome.action : undefined;

  const forward = async (action: 'forward' | 'again') => {
    if (access.kind !== 'ready' || pending !== undefined || (action === 'again' && last === undefined)) {
      return;
    }

    setOutcome({ kind: 'pending', action });
    try {
      const answer = await access.ports.forward(forwardRequest(action === 'again' ? last?.localPort : undefined));
      setLast(answer);
      setOutcome({ kind: 'started', sessionId: answer.sessionId, localHost: answer.localHost, localPort: answer.localPort });
    } catch (error: unknown) {
      setOutcome({ kind: 'refused', ...refusalOf(error, START_FALLBACK) });
    }
  };

  const stop = async () => {
    if (access.kind !== 'ready' || pending !== undefined || last === undefined) {
      return;
    }

    setOutcome({ kind: 'pending', action: 'stop' });
    try {
      await last.stop();
      setOutcome({ kind: 'stopped', sessionId: last.sessionId });
    } catch (error: unknown) {
      setOutcome({ kind: 'stop-refused', ...refusalOf(error, STOP_FALLBACK) });
    }
  };

  /** Why a button cannot be pressed now, or nothing when it can: the page cannot forward at all, there is no forward yet to stop or to ask for the port of, or another button's call is under way. */
  const reasonFor = (action: ForwardAction): string | undefined => {
    if (access.kind !== 'ready') {
      return WHY_NOT[access.kind];
    }

    if (action !== 'forward' && last === undefined) {
      return NO_FORWARD_WORDS;
    }

    return pending !== undefined && pending !== action ? PENDING_WORDS : undefined;
  };

  const reasons = { forward: reasonFor('forward'), stop: reasonFor('stop'), again: reasonFor('again') };
  // At most one reason is in force at a time (they are the same words for the buttons that have one), and the page prints it once.
  const printed = reasons.forward ?? reasons.stop ?? reasons.again;
  const words = outcomeWords(outcome);

  return (
    <Stack direction="row" gap={8} align="center">
      <Button
        size="row"
        busy={pending === 'forward'}
        disabledReason={reasons.forward}
        onClick={() => {
          void forward('forward');
        }}
      >
        {FORWARD_LABEL}
      </Button>
      <Button
        size="row"
        busy={pending === 'stop'}
        disabledReason={reasons.stop}
        onClick={() => {
          void stop();
        }}
      >
        {STOP_LABEL}
      </Button>
      <Button
        size="row"
        busy={pending === 'again'}
        disabledReason={reasons.again}
        onClick={() => {
          void forward('again');
        }}
      >
        {AGAIN_LABEL}
      </Button>
      <span role="status">{words === undefined ? null : <Text>{words}</Text>}</span>
      {printed === undefined ? null : <Text tone="muted">{printed}</Text>}
    </Stack>
  );
}

const COLUMNS: ReadonlyArray<DataTableColumn<TargetRow>> = [
  { id: 'name', header: 'Name', fit: 'flex', width: 160, text: (row) => row.name, cell: (row) => <Text>{row.name}</Text>, sortKey: (row) => row.name },
  { id: 'port', header: 'Port', fit: 'fixed', width: 96, cell: (row) => <Text tone="muted">{`:${String(row.port)}/TCP`}</Text> },
  // A fixed cell is not clipped, and it is wide enough for the three buttons and what the page says of the last call.
  { id: 'forward', header: 'Forward', fit: 'fixed', width: 1040, cell: (row) => <ForwardControl access={row.access} /> },
];

const refreshNothing = async (): Promise<void> => undefined;

function useTargets({ plugin, route, panel }: ContextV1): ListPageViewV1<TargetRow> {
  const chosen = useChosenConnection(plugin, route.connection);
  const inConnection = route.connection !== undefined;
  const ports = panel?.ports;
  const source = useMemo<ListSource<TargetRow>>(
    () => ({ state: { kind: 'ready' }, rows: targetsOf(accessOf(ports, inConnection)), complete: true, refreshing: false, refresh: refreshNothing }),
    [ports, inConnection],
  );
  return { frame: targetsFrame(frameConnectionOf(route.connection, chosen)), source };
}

export const portsPage = {
  kind: 'list',
  definition: {
    title: TITLE,
    nouns: { one: 'Target', other: 'Targets' },
    columns: COLUMNS,
    lines: 1,
    getRowKey: (row) => row.id,
    searchText: (row) => `${row.name} ${String(row.port)}`.toLowerCase(),
  },
  usePage: useTargets,
} satisfies ListPageV1<TargetRow>;
