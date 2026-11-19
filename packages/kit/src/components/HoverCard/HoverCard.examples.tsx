import {
  Button,
  HoverCardHost,
  Icon,
  IconButton,
  KeyValue,
  KindTile,
  Link,
  LinkProvider,
  Stack,
  Status,
  Text,
  type HoverCardContent,
  type LinkHandler,
  type LinkTarget,
} from '@omniviewdev/kit';

// A card needs a host with a `render`, and a window has one host: the host is mounted once by the application (ui-next/main.tsx), never by an
// example. This file is the one exception, because the parts page renders every example at once and only one of them may mount a host: the
// example below mounts its own, so the triggers it shows have a card to open. A trigger is the data attribute `hoverCard('key')` returns
// (`data-ov-card`, with `data-ov-card-arrow` for `{ arrow: 'down' }`) and the anchor is `hoverCardAnchor()`'s (`data-ov-card-anchor`), which a
// part passes through like any `data-*`; examples write them out.

const hrefOf = (target: LinkTarget) => `#/${target.page}?name=${target.params?.name ?? ''}`;
// The links of the cards go nowhere: the example is about the card, not the destination.
const QUIET: LinkHandler = { hrefOf, onOpen: () => undefined };

/** The facts of a card: label and value, in rows of the compact list. */
const FACTS = [
  { label: 'Connection', value: 'dev-local' },
  { label: 'Region', value: 'eu-1' },
  { label: 'Container', value: 'orders-api' },
];

/** The content of each card, by the key its trigger carries. The host asks for one while it is open; an unknown key has none. */
const CARDS: Readonly<Record<string, HoverCardContent>> = {
  logs: {
    label: 'Logs for orders-api',
    announce: 'Logs for orders-api, streaming since 08:41. Press Down Arrow to reach its actions.',
    content: (
      <>
        <Stack direction="row" gap={8} align="center">
          <Icon name="server" />
          <Text variant="title">Logs</Text>
        </Stack>
        <Stack direction="row" gap={8} align="center">
          <KindTile icon="box" tone="blue" />
          <Link to={{ page: 'services', params: { name: 'orders-api' } }}>Service orders-api</Link>
        </Stack>
        <KeyValue
          labelWidth={96}
          rows={[
            ...FACTS,
            {
              label: 'State',
              value: (
                <Stack direction="row" gap={4} align="center">
                  <Status role="running">Streaming</Status>
                  <Text tone="muted">since 08:41</Text>
                </Stack>
              ),
            },
          ]}
        />
        <Stack direction="row" gap={8} align="center">
          <Button size="compact">Open service</Button>
          <Button size="compact">Stop</Button>
        </Stack>
      </>
    ),
  },
  shell: {
    label: 'Shell in orders-api',
    announce: 'Shell in orders-api, failed. Press Down Arrow to reach its actions.',
    content: (
      <>
        <Stack direction="row" gap={8} align="center">
          <Icon name="server" />
          <Text variant="title">Shell</Text>
        </Stack>
        <Stack direction="row" gap={8} align="center">
          <KindTile icon="box" tone="blue" />
          <Link to={{ page: 'services', params: { name: 'orders-api' } }}>Service orders-api</Link>
        </Stack>
        <KeyValue
          labelWidth={96}
          rows={[
            ...FACTS,
            {
              label: 'State',
              value: (
                <Stack direction="row" gap={4} align="center">
                  <Status role="error">Failed</Status>
                  <Text tone="muted">since 08:12</Text>
                </Stack>
              ),
            },
          ]}
        />
        <Text variant="caption">The connection closed before the shell started. Check that the service is running, then retry.</Text>
        <Stack direction="row" gap={8} align="center">
          <Button size="compact">Open service</Button>
          <Button size="compact">Retry</Button>
        </Stack>
      </>
    ),
  },
  notes: {
    label: 'About notes',
    content: (
      <>
        <Text variant="title">Notes</Text>
        <Text>Plain text only: a card with nothing to press is reached by hover and by focus, and has no way in by the Down arrow.</Text>
      </>
    ),
  },
};

const render = (key: string): HoverCardContent | undefined => CARDS[key];

/** A trigger that is the label of a tab, and its close button: the tab is the anchor, so the card hangs below the whole tab and never covers the button. */
function Tab({ card, label }: { readonly card: string; readonly label: string }) {
  return (
    <Stack direction="row" gap={4} align="center" data-ov-card-anchor="">
      <Button variant="ghost" size="compact" data-ov-card={card} data-ov-card-arrow="down">
        {label}
      </Button>
      <IconButton icon="close" label={`Close ${label}`} variant="ghost" size="row" />
    </Stack>
  );
}

/**
 * Tabs that show a card: rest the pointer on one for half a second, or Tab to it. The tab is the anchor and its label the trigger, so the
 * card opens below the tab, hangs from its start and never covers its close button; it holds a link to the resource, a compact list of
 * facts, a state and at most two buttons. The pointer can cross onto the card and stays on it; the card never takes the focus on its own:
 * Down on a focused tab moves into it (Tab and the arrows walk its controls and wrap), and Escape closes it and gives the focus back. The
 * last trigger has no arrow and a card of plain text. Without the Popover API (a test engine) the triggers show and no card can open.
 */
export const TabsWithCards = () => (
  <LinkProvider handler={QUIET}>
    <Stack direction="row" gap={16} align="center">
      <Tab card="logs" label="Logs · orders-api" />
      <Tab card="shell" label="Shell · orders-api" />
      <Button variant="secondary" size="compact" data-ov-card="notes">
        Notes
      </Button>
    </Stack>
    {typeof HTMLElement.prototype.showPopover === 'function' ? <HoverCardHost render={render} /> : null}
  </LinkProvider>
);
