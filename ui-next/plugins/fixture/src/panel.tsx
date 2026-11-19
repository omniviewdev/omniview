import { Text } from '@omniviewdev/kit';
import { useEffect, useState } from 'react';
import type { PanelBodyPropsV1, PanelCardV1, PanelSessionOpenV1, PanelSessionV1, PanelToolV1 } from '../../contract/v1';
import styles from './fixture.module.css';

// The fixture's tool in the bottom panel: "Streams", the proof of the panel contribution (contract/v1.ts, `panel`) from outside the host's bundle. A session of it is a neutral stream of lines that
// a body counts: it ticks while its session runs, and a body that is hidden keeps ticking (a streaming session keeps its buffer: docs/ui-next/optimisations.md HLT-32), which a check reads from
// `data-lines`. The `+` opens three sessions in turn, one in each state the panel draws: running, ended and failed. Each belongs to an item of the fixture's list, so its card links to the item's page.

/** How often a running stream gets a line: fast enough for a check to see it count while the body is hidden. */
const LINE_MS = 100;

/** A running stream's body: its words, and how many lines it has had. The count lives in the body, which the panel keeps mounted for as long as the session lives. */
function StreamBody({ session, visible }: PanelBodyPropsV1) {
  const [lines, setLines] = useState(0);
  const running = session.state === 'running';
  useEffect(() => {
    if (!running) {
      return undefined;
    }

    const timer = setInterval(() => {
      setLines((count) => count + 1);
    }, LINE_MS);
    return () => {
      clearInterval(timer);
    };
  }, [running]);

  return (
    <div className={styles.stream} data-fixture="stream" data-session={session.title} data-state={session.state} data-visible={visible ? 'true' : 'false'} data-lines={lines}>
      <Text>{`${session.title} · ${session.state}`}</Text>
      <Text tone="muted">{`${String(lines)} lines`}</Text>
    </div>
  );
}

/** The three streams the `+` opens in turn: a running one, one that ended and one that failed to start, each belonging to an item of the list. */
const OPENS: readonly PanelSessionOpenV1[] = [
  { title: 'stream-alpha', scope: 'north-yard', route: { page: 'item', params: { name: 'orders-api', group: 'north-yard' } }, state: 'running' },
  { title: 'stream-beta', scope: 'north-yard', route: { page: 'item', params: { name: 'ledger-sync', group: 'north-yard' } }, state: 'ended', cause: 'The stream closed.' },
  { title: 'stream-gamma', scope: 'south-yard', route: { page: 'item', params: { name: 'ghost-service', group: 'south-yard' } }, state: 'failed', cause: 'The source did not answer' },
];

let opened = 0;

/** The next stream: the three in order, and then again (a fourth `stream-alpha` is a twin of the first, which the strip tells apart with an ordinal). */
function nextStream(): PanelSessionOpenV1 | undefined {
  const next = OPENS[opened % OPENS.length];
  opened += 1;
  return next;
}

/** What the card of a stream says: the kind, the item it belongs to as a link, its source, its state in the plugin's words and what can be done with it (nothing runs in a failed one). */
function streamCard(session: PanelSessionV1): PanelCardV1 {
  const item = session.route?.params.name;
  return {
    kind: 'Stream',
    resource: session.route === undefined || item === undefined ? undefined : { label: `Item ${item}`, kind: 'Item', route: session.route },
    facts: [['Source', session.scope]],
    state: session.state === 'running' ? { label: 'Streaming' } : session.state === 'failed' ? { reason: `${session.cause}. Check the source, then open the stream again.` } : undefined,
    actions:
      session.state === 'failed'
        ? []
        : [
          {
            label: 'Copy name',
            onSelect: () => {
              Reflect.set(window, '__fixtureCopied', session.title);
            },
          },
        ],
  };
}

export const streamsTool = {
  label: 'Streams',
  icon: 'server',
  order: 40,
  Body: StreamBody,
  card: streamCard,
  newSession: { label: 'New stream', open: nextStream },
} satisfies PanelToolV1;
