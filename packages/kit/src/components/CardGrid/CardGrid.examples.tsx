import { Button, CardGrid, KindTile, ResourceCard, Status, type CardGridGroup, type ResourceCardTone, type StatusRole } from '@omniviewdev/kit';
import type { ReactNode } from 'react';
import styles from './CardGrid.examples.module.css';

// A collection written the way a consumer writes it: the items are the caller's, and so is the one function that draws a card from an item.
// The data is neutral: connections to a service, each in an environment, with a state, a region and a version.
type Connection = {
  readonly id: string;
  readonly name: string;
  readonly environment: string;
  readonly word: string;
  readonly role: StatusRole;
  readonly region: string;
  readonly version: string;
  readonly tone?: ResourceCardTone | undefined;
};

const STATES: ReadonlyArray<{ readonly word: string; readonly role: StatusRole; readonly tone?: ResourceCardTone }> = [
  { word: 'Connected', role: 'healthy' },
  { word: 'Connected', role: 'healthy' },
  { word: 'Connected', role: 'healthy' },
  { word: 'Disconnected', role: 'stopped' },
  { word: 'Needs attention', role: 'attention', tone: 'warning' },
  { word: 'Unreachable', role: 'error', tone: 'error' },
];

const ENVIRONMENTS = ['production', 'staging', 'testing', 'development', 'sandbox'];
const REGIONS = ['us-east-1', 'eu-west-1', 'ap-south-1'];

function connection(index: number): Connection {
  const state = STATES[index % STATES.length] ?? { word: 'Connected', role: 'healthy' as const };
  return {
    id: `connection-${String(index).padStart(3, '0')}`,
    name: `Connection ${String(index + 1)}`,
    environment: ENVIRONMENTS[index % ENVIRONMENTS.length] ?? 'production',
    word: state.word,
    role: state.role,
    region: REGIONS[index % REGIONS.length] ?? 'us-east-1',
    version: `1.${String(28 + (index % 4))}.${String(index % 7)}`,
    ...(state.tone === undefined ? {} : { tone: state.tone }),
  };
}

const getKey = (item: Connection) => item.id;

// One function for every card, made once: a card is drawn again only when its item is another object.
const renderCard = (item: Connection): ReactNode => (
  <ResourceCard
    title={item.name}
    lead={<KindTile icon="server" />}
    status={<Status role={item.role}>{item.word}</Status>}
    meta={item.environment}
    metrics={[
      { label: 'Platform', value: 'Generic' },
      { label: 'Region', value: item.region },
      { label: 'Version', value: item.version },
    ]}
    tone={item.tone}
    actions={<Button>Open</Button>}
  />
);

const CONNECTIONS: readonly Connection[] = Array.from({ length: 12 }, (_, index) => connection(index));
const ONE = CONNECTIONS.slice(0, 1);
const THREE = CONNECTIONS.slice(0, 3);
const WITH_TONES = CONNECTIONS.slice(2, 8);

function groupsOf(connections: readonly Connection[], by: (item: Connection) => string, meta: (count: number) => string): Array<CardGridGroup<Connection>> {
  const named = new Map<string, Connection[]>();
  for (const item of connections) {
    named.set(by(item), [...(named.get(by(item)) ?? []), item]);
  }

  return [...named].map(([title, items]) => ({ id: title, title, meta: meta(items.length), items }));
}

const count = (n: number) => `${String(n)} ${n === 1 ? 'connection' : 'connections'}`;

const BY_ENVIRONMENT = groupsOf(CONNECTIONS, (item) => item.environment, count);

/** Ungrouped: the cards of a list, in columns of 280 px at the least that share the width. Resize the page: the columns come and go and the cards never get narrower. */
export const Ungrouped = () => (
  <div className={styles.frame}>
    <CardGrid label="Connections" items={CONNECTIONS} getKey={getKey} renderCard={renderCard} />
  </div>
);

/** Groups are labelled sections: a heading, a muted line beside it (here the count) and the cards, the sections 20 px apart. */
export const Grouped = () => (
  <div className={styles.frame}>
    <CardGrid label="Connections" groups={BY_ENVIRONMENT} getKey={getKey} renderCard={renderCard} />
  </div>
);

/** One card in a wide box takes the width of the box: the columns that have no card give theirs up. */
export const OneCard = () => (
  <div className={styles.frame}>
    <CardGrid label="Connections" items={ONE} getKey={getKey} renderCard={renderCard} />
  </div>
);

/** The edge of a card is the one thing the tone changes, and the status says the same in words: neutral, warning and error side by side. */
export const AttentionTones = () => (
  <div className={styles.frame}>
    <CardGrid label="Connections" items={WITH_TONES} getKey={getKey} renderCard={renderCard} />
  </div>
);

const LONG: readonly Connection[] = [
  { ...connection(0), name: 'connection-with-a-very-long-name-that-cannot-fit-in-one-line', environment: 'arn:example:service:us-east-1:123456789012:connection/long-identifier' },
  { ...connection(1), name: 'another-connection-with-an-equally-long-name-for-the-column' },
  { ...connection(4), name: 'a-long-name-on-a-card-with-an-edge-that-needs-attention', environment: 'a-long-environment-name-that-is-cut-like-the-title' },
];

/** Names longer than the column: the title and the muted line give way with an ellipsis, never wrap, and the status and the grid hold their places. */
export const LongNames = () => (
  <div className={styles.frame}>
    <CardGrid label="Connections" items={LONG} getKey={getKey} renderCard={renderCard} />
  </div>
);

/** A box narrower than 280 px: one column, as wide as the box. */
export const Narrow = () => (
  <div className={styles.narrow}>
    <CardGrid label="Connections" items={THREE} getKey={getKey} renderCard={renderCard} />
  </div>
);

const MANY: readonly Connection[] = Array.from({ length: 500 }, (_, index) => connection(index));
const MANY_GROUPS = groupsOf(MANY, (item) => item.environment, count);

/**
 * Five hundred cards in five groups, held in the page and not windowed: a long collection is cheap because each card's cell is contained and the browser
 * skips the ones far off screen. Scroll the box, and use Tab: the controls of the cards that are off screen are reached all the same.
 */
export const FiveHundredCards = () => (
  <div className={styles.scroll}>
    <CardGrid label="Connections" groups={MANY_GROUPS} getKey={getKey} renderCard={renderCard} />
  </div>
);
