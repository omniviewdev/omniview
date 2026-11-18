// The fixture's items: the list shows them and each one opens a detail page. Neutral data, one item in each state the detail page's data can be in, so a check can open each.

/** What the detail page of an item does when it is read. */
export type Mode = 'ready' | 'loading' | 'not-found' | 'denied' | 'failing';

export type Item = {
  /** The identity of the row in the list: the name. */
  readonly id: string;
  readonly name: string;
  readonly group: string;
  /** What its detail does, in the words the list shows. */
  readonly mode: Mode;
  readonly opens: string;
};

export const ITEMS: readonly Item[] = [
  { id: 'orders-api', name: 'orders-api', group: 'north-yard', mode: 'ready', opens: 'ready' },
  { id: 'ledger-sync', name: 'ledger-sync', group: 'north-yard', mode: 'loading', opens: 'loading' },
  { id: 'ghost-service', name: 'ghost-service', group: 'south-yard', mode: 'not-found', opens: 'not found' },
  { id: 'vault-keeper', name: 'vault-keeper', group: 'east-dock', mode: 'denied', opens: 'denied' },
  { id: 'flaky-gateway', name: 'flaky-gateway', group: 'west-dock', mode: 'failing', opens: 'error' },
];

/** How an item behaves, by name. A name the fixture does not know is an item that does not exist. */
export const modeOf = (name: string): Mode => ITEMS.find((item) => item.name === name)?.mode ?? 'not-found';

/** How long the fixture's read takes: long enough for the loading state to be seen and measured, short enough for a check to wait for. */
export const READ_MS = 450;
