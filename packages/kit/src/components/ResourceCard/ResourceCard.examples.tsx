import {
  Button,
  IconButton,
  KindTile,
  LinkProvider,
  MissingValue,
  ResourceCard,
  Stack,
  Status,
  Text,
  menuTrigger,
  useMenu,
  type LinkHandler,
  type LinkTarget,
  type ResourceCardMetric,
} from '@omniviewdev/kit';
import { useState, type ReactNode } from 'react';
import styles from './ResourceCard.examples.module.css';

// Cards written the way a consumer writes them: the facts and the words are the caller's. The data is neutral: connections to a service.
const METRICS: readonly ResourceCardMetric[] = [
  { label: 'Platform', value: 'Generic' },
  { label: 'Region', value: 'us-east-1' },
  { label: 'Version', value: '1.31.2' },
];

const hrefOf = (target: LinkTarget) => `#/${target.page}/${target.params?.id ?? ''}`;

// A handler that goes nowhere: the examples are about the look of the card.
const QUIET: LinkHandler = { hrefOf, onOpen: () => undefined };

const TARGET: LinkTarget = { page: 'connection', params: { id: 'connection-a' } };

function Frame({ children, narrow = false }: { readonly children: ReactNode; readonly narrow?: boolean }) {
  return <div className={narrow ? styles.narrow : styles.frame}>{children}</div>;
}

/** The identity, one muted line and three facts: a card that has nothing to do. */
export const Plain = () => (
  <Frame>
    <ResourceCard title="Connection A" lead={<KindTile icon="server" />} status={<Status role="healthy">Connected</Status>} meta="production" metrics={METRICS} />
  </Frame>
);

/** The title is the link and the commands are its siblings: the Tab stops are the link, Open and More actions. No control is inside another. */
export const WithLinkAndActions = () => (
  <LinkProvider handler={QUIET}>
    <Frame>
      <ResourceCard
        title="Connection A"
        to={TARGET}
        lead={<KindTile icon="server" />}
        status={<Status role="healthy">Connected</Status>}
        meta="production"
        metrics={METRICS}
        actions={
          <>
            <Button>Open</Button>
            <IconButton variant="ghost" icon="ellipsis" label="More actions for Connection A" />
          </>
        }
      />
    </Frame>
  </LinkProvider>
);

/** A warning edge: the border only. The status says it in words, so the colour is never the one cue. */
export const ToneWarning = () => (
  <Frame>
    <ResourceCard
      title="Connection B"
      lead={<KindTile icon="server" />}
      status={<Status role="attention">Needs attention</Status>}
      meta="staging"
      metrics={METRICS}
      tone="warning"
      actions={<Button>Review</Button>}
    />
  </Frame>
);

export const ToneError = () => (
  <Frame>
    <ResourceCard
      title="Connection C"
      lead={<KindTile icon="server" />}
      status={<Status role="error">Unreachable</Status>}
      meta="production"
      metrics={METRICS}
      tone="error"
      actions={<Button>Retry</Button>}
    />
  </Frame>
);

/** A name longer than the card: the title and the muted line give way with an ellipsis and never wrap; the status keeps its place. The tip shows the rest. */
export const LongTitle = () => (
  <Frame narrow>
    <ResourceCard
      title="connection-with-a-very-long-name-that-cannot-fit-in-one-line"
      lead={<KindTile icon="server" />}
      status={<Status role="healthy">Connected</Status>}
      meta="arn:example:service:us-east-1:123456789012:connection/with-a-very-long-identifier"
      metrics={METRICS}
      actions={<Button>Open</Button>}
    />
  </Frame>
);

/** A fact that is not known is the dash, named for what is missing and why. It is never zero or a made-up value. */
export const MissingMetric = () => (
  <Frame>
    <ResourceCard
      title="Connection D"
      lead={<KindTile icon="server" />}
      status={<Status role="stopped">Disconnected</Status>}
      meta="development"
      metrics={[
        { label: 'Platform', value: 'Generic' },
        { label: 'Region', value: <MissingValue name="Not set" reason="No region is configured." /> },
        { label: 'Version', value: <MissingValue name="Not loaded" reason="Connect to see the version." /> },
      ]}
    />
  </Frame>
);

/** Without a lead the title starts at the card's edge, and the muted line under it with it. */
export const NoLead = () => (
  <Frame>
    <ResourceCard title="Connection E" status={<Status role="running">Running</Status>} meta="testing" metrics={METRICS} />
  </Frame>
);

/** Only the identity: no line under it, no facts, no commands. */
export const TitleOnly = () => (
  <Frame>
    <ResourceCard title="Connection F" />
  </Frame>
);

/**
 * One menu for the whole view, registered once with `useMenu`; every card names itself with its key. Press Shift+F10 on the title or a command, or
 * right-click the card; the More actions button opens the same menu from its own trigger. Choose one.
 */
export const WithMenu = () => {
  const [last, setLast] = useState('nothing');
  const menu = useMenu((key) =>
    key === undefined
      ? []
      : [
        {
          kind: 'action',
          id: 'open',
          label: 'Open',
          onSelect: () => {
            setLast(`Open ${key}`);
          },
        },
        {
          kind: 'action',
          id: 'copy',
          label: 'Copy identifier',
          onSelect: () => {
            setLast(`Copy identifier of ${key}`);
          },
        },
      ],
  );

  return (
    <LinkProvider handler={QUIET}>
      <Stack gap={8}>
        <Frame>
          <ResourceCard
            title="Connection A"
            to={TARGET}
            lead={<KindTile icon="server" />}
            status={<Status role="healthy">Connected</Status>}
            meta="production"
            metrics={METRICS}
            menu={{ id: menu, key: 'connection-a' }}
            actions={
              <>
                <Button>Open</Button>
                <IconButton {...menuTrigger(menu, 'connection-a')} variant="ghost" icon="ellipsis" label="Actions for Connection A" />
              </>
            }
          />
        </Frame>
        <Text variant="caption" tone="muted">
          Last action: {last}
        </Text>
      </Stack>
    </LinkProvider>
  );
};
