import { Button, Stack, Text, type DataTableColumn } from '@omniviewdev/kit';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ContextV1, FrameV1, ListPageV1, ListPageViewV1, ListSource, PanelHostV1, PortForwardRequestV1, PortForwardSessionV1 } from '../../contract/v1';
import { connectionFace, useChosenConnection, type PageConnection } from './connection';
import {
  AGAIN_LABEL,
  ASKED,
  FORWARD_HOST,
  FORWARD_LABEL,
  LAPSED_LABEL,
  LAPSE_MS,
  LONG_ID_LABEL,
  MANY_LABEL,
  NO_CONNECTION_WORDS,
  NO_FORWARD_WORDS,
  NO_PORTS_WORDS,
  PENDING_WORDS,
  PORTS_NAME,
  START_FALLBACK,
  STOP_ALL_LABEL,
  STOP_FALLBACK,
  STOP_LABEL,
  TARGET_ID,
  TARGET_PORT,
  askedOf,
  forwardRequest,
  longIdRequest,
  outcomeWords,
  refusalOf,
  type ForwardAction,
  type ForwardOutcome,
} from './ports';

// The page of the ports fixture (ports.ts says what the plugin is): one list with one row, the target, whose last cell holds the seven buttons that ask the host to forward the target's port, to stop the forward it last answered, to forward
// the same port again, to forward it a thousand times at once, to stop every forward the page holds, to forward with an id of a mebibyte and to forward after the action that made the press has lapsed, and says what became of the last call.
// The last four are for the check that drives the host's rules (a forward starts only from a user action, a plugin may hold only so many, an id has a bound) in a real engine. The page is read in the plugin's one connection (connection.ts, as the
// connections fixture's page is) and asks through the handle the host gave it, `ctx.panel.ports`, which the host binds to this plugin and this connection: the request names neither. What the page says of a call is the host's answer or the host's
// refusal, by its code and in its words. A page that has no handle says why it has none: the host gives none to a page that is open in no connection, and an older host gives none at all. Its buttons stay where they are, with the reason on each
// and on the page.

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

/** The seven buttons in the order they are drawn, each with the name a check finds it by. */
const BUTTONS: ReadonlyArray<{ readonly action: ForwardAction; readonly label: string }> = [
  { action: 'forward', label: FORWARD_LABEL },
  { action: 'stop', label: STOP_LABEL },
  { action: 'again', label: AGAIN_LABEL },
  { action: 'many', label: MANY_LABEL },
  { action: 'stop-all', label: STOP_ALL_LABEL },
  { action: 'long-id', label: LONG_ID_LABEL },
  { action: 'lapsed', label: LAPSED_LABEL },
];

/**
 * The seven buttons and what the page says of them. THE ANSWERS IT HOLDS: `held` is every forward the host answered that the page has not stopped, in the order they were answered: each start by the first button, by the one that forwards the
 * same port again, by the thousand and by the two that are not expected to start (the id of a mebibyte, the wait) adds its answer, and a stop the host answered, Stop's or Stop all's, takes it out; one the host refused to stop stays. `last` is a
 * different thing and is kept as it was in the first slice: the answer the host gave LAST (of a thousand, the last that started in the order of the calls), which Stop stops and Forward the same port again asks the port of; a refusal leaves it
 * as it was, and a stop does not clear it (the host answers a stop for a forward it no longer has too, so a press after it is the contract's second call, and the same port can be asked for again once it is free). So Stop stops one forward,
 * the last, and Stop all stops every one the page holds, and neither knows of what the person or another window stopped: the host answers for those too. ONE CALL IS UNDER WAY AT A TIME: the button that was pressed is busy, and each of the
 * others says why it waits (`PENDING_WORDS`), so that no button is drawn that a press does nothing on. A button that has nothing to act on says so (`NO_FORWARD_WORDS`), and each reason in force is printed once, whichever buttons carry it.
 * What became of the last call is said in a status the page has from the start, so that it is read out when it arrives, and the next call takes its place. A refusal is said by the class the host gave it and in the words it gave.
 * EVERY CALL THAT STARTS A FORWARD IS MADE IN THE PRESS, before anything is awaited: the host asks for a user action at the call, and the action that made a press lasts a few seconds. The fourth button is the exception on purpose: it waits
 * longer than that and then asks from a timer, which the host refuses; the timer is the page's and ends with it.
 */
export function ForwardControl({ access }: { readonly access: ForwardAccess }) {
  const [outcome, setOutcome] = useState<ForwardOutcome>({ kind: 'idle' });
  const [last, setLast] = useState<PortForwardSessionV1 | undefined>(undefined);
  const [held, setHeld] = useState<readonly PortForwardSessionV1[]>([]);
  const lapse = useRef<number | undefined>(undefined);
  const pending: ForwardAction | undefined = outcome.kind === 'pending' ? outcome.action : outcome.kind === 'waiting' ? 'lapsed' : undefined;

  // A page that goes asks nothing after it: the wait of the fourth button ends with the page.
  useEffect(
    () => () => {
      window.clearTimeout(lapse.current);
    },
    [],
  );

  /** Takes the forwards the host answered into what the page holds, and the newest of them is the last answer. */
  const adopt = (answers: readonly PortForwardSessionV1[]) => {
    const newest = answers.at(-1);
    if (newest !== undefined) {
      setLast(newest);
      setHeld((current) => [...current, ...answers]);
    }
  };

  /** Asks the host for one forward with `request` and says what came of it: the call of the first, the second, the third and the fourth button. */
  const askOne = async (ports: Ports, action: ForwardAction, request: PortForwardRequestV1) => {
    setOutcome({ kind: 'pending', action });
    try {
      const answer = await ports.forward(request);
      adopt([answer]);
      setOutcome({ kind: 'started', sessionId: answer.sessionId, localHost: answer.localHost ?? FORWARD_HOST, localPort: answer.localPort });
    } catch (error: unknown) {
      setOutcome({ kind: 'refused', ...refusalOf(error, START_FALLBACK) });
    }
  };

  /** Asks the host for `ASKED` forwards, in one synchronous loop: every call is made in the press and all are in flight before the first is answered. What the host answered is said once all have been answered, and the ones that started are held. */
  const many = async (ports: Ports) => {
    setOutcome({ kind: 'pending', action: 'many' });
    const asking = Array.from({ length: ASKED }, async () => ports.forward(forwardRequest()));
    const results = await Promise.allSettled(asking);
    adopt(results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])));
    setOutcome(askedOf(results));
  };

  /** Stops the last answer, and when the host has stopped it the page does not hold it any more. */
  const stop = async (target: PortForwardSessionV1) => {
    setOutcome({ kind: 'pending', action: 'stop' });
    try {
      await target.stop();
      setHeld((current) => current.filter((answer) => answer !== target));
      setOutcome({ kind: 'stopped', sessionId: target.sessionId });
    } catch (error: unknown) {
      setOutcome({ kind: 'stop-refused', ...refusalOf(error, STOP_FALLBACK) });
    }
  };

  /** Stops every forward the page holds, every stop asked at once in the press. The ones the host stopped are not held any more, and the ones it refused to stop are. */
  const stopAll = async (stopping: readonly PortForwardSessionV1[]) => {
    setOutcome({ kind: 'pending', action: 'stop-all' });
    const results = await Promise.allSettled(stopping.map(async (answer) => answer.stop()));
    const refused = stopping.filter((_, index) => results[index]?.status === 'rejected');
    setHeld(refused);
    setOutcome({ kind: 'stopped-all', stopped: stopping.length - refused.length, of: stopping.length });
  };

  /** Waits `LAPSE_MS`, longer than the user action that made the press lasts, and then asks one forward as the first button does. The call is made from the timer, which is the page's: it is cleared with the page. */
  const lapsed = (ports: Ports) => {
    setOutcome({ kind: 'waiting' });
    lapse.current = window.setTimeout(() => {
      lapse.current = undefined;
      void askOne(ports, 'lapsed', forwardRequest());
    }, LAPSE_MS);
  };

  /** Why a button cannot be pressed now, or nothing when it can: the page cannot forward at all, there is no forward yet to stop, to stop all of or to ask for the port of, or another button's call is under way. */
  const reasonFor = (action: ForwardAction): string | undefined => {
    if (access.kind !== 'ready') {
      return WHY_NOT[access.kind];
    }

    if (((action === 'stop' || action === 'again') && last === undefined) || (action === 'stop-all' && held.length === 0)) {
      return NO_FORWARD_WORDS;
    }

    return pending !== undefined && pending !== action ? PENDING_WORDS : undefined;
  };

  const press = (action: ForwardAction) => {
    if (access.kind !== 'ready' || pending !== undefined || reasonFor(action) !== undefined) {
      return;
    }

    const { ports } = access;
    switch (action) {
      case 'forward':
        void askOne(ports, 'forward', forwardRequest());
        break;
      case 'again':
        void askOne(ports, 'again', forwardRequest(last?.localPort));
        break;
      case 'long-id':
        void askOne(ports, 'long-id', longIdRequest());
        break;
      case 'many':
        void many(ports);
        break;
      case 'stop':
        if (last !== undefined) {
          void stop(last);
        }

        break;
      case 'stop-all':
        void stopAll(held);
        break;
      case 'lapsed':
        lapsed(ports);
        break;
    }
  };

  const reasons = BUTTONS.map(({ action }) => reasonFor(action));
  // Each reason in force is printed once, whichever buttons carry it.
  const printed = [...new Set(reasons.filter((reason): reason is string => reason !== undefined))];
  const words = outcomeWords(outcome);

  return (
    <Stack direction="row" gap={8} align="center">
      {BUTTONS.map(({ action, label }, index) => (
        <Button
          key={action}
          size="row"
          busy={pending === action}
          disabledReason={reasons[index]}
          onClick={() => {
            press(action);
          }}
        >
          {label}
        </Button>
      ))}
      <span role="status">{words === undefined ? null : <Text>{words}</Text>}</span>
      {printed.map((reason) => (
        <Text key={reason} tone="muted">
          {reason}
        </Text>
      ))}
    </Stack>
  );
}

const COLUMNS: ReadonlyArray<DataTableColumn<TargetRow>> = [
  { id: 'name', header: 'Name', fit: 'flex', width: 160, text: (row) => row.name, cell: (row) => <Text>{row.name}</Text>, sortKey: (row) => row.name },
  { id: 'port', header: 'Port', fit: 'fixed', width: 96, cell: (row) => <Text tone="muted">{`:${String(row.port)}/TCP`}</Text> },
  // A fixed cell is not clipped, and it is wide enough for the seven buttons; what the page says of the last call runs on past them.
  { id: 'forward', header: 'Forward', fit: 'fixed', width: 1480, cell: (row) => <ForwardControl access={row.access} /> },
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
