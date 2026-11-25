// The neutral connections the Home perf probe (home-perf.mjs) and its fixture (home-fixture.tsx) share: ONE plugin and two hundred connections, made from a few invented words so that the same list is the same on both sides.
// The host and its probes name no real plugin and no domain of one (decision A13, AGENTS rule 15).
//
// What the list holds, by the index of the connection (the first is 0): a name that is a word and a number, and from time to time a name of more than eighty characters (every eighth, or all of them with `long`); a secondary text on every third; a connection
// that is disconnected (every fifth from the second), one that is failed with the host's reason (every ninth from the fifth), one that needs sign-in with its reason (every eleventh from the seventh) and one that is connecting (every twenty-third from the eighth); the rest
// are connected. `TARGET_INDEX` and `SECOND_INDEX` are connected and disconnected: the connections an event goes to.

export const PLUGIN = Object.freeze({ id: 'fixture-source', name: 'Fixture Source' });
export const COUNT = 200;
/** The connection a single event goes to: in the middle of the list, connected. */
export const TARGET_INDEX = 100;
/** The connection the control `second-row` tells of together with the first. */
export const SECOND_INDEX = 101;
/** The character typed in the field: it keeps the connections whose name or text holds it and sends the others away. */
export const QUERY = 'j';

const WORDS = ['Alder', 'Birch', 'Cedar', 'Dune', 'Ember', 'Fiord', 'Grove', 'Harbor', 'Isle', 'Juniper'];
const ZONES = ['north-1', 'north-2', 'south-1', 'east-1', 'west-2'];
const TAIL = 'with a name that goes on and on and on, past the end of any row a window can draw it in';

const keyOf = (index) => `conn-${String(index + 1).padStart(3, '0')}`;

/** The state of the connection at `index`, and the host's reason when it failed. */
export function stateOf(index) {
  if (index % 9 === 4) return { state: 'failed', reason: 'The connection did not start.' };
  if (index % 11 === 6) return { state: 'unauthorized', reason: 'The connection needs you to sign in.' };
  if (index % 23 === 7) return { state: 'connecting', reason: undefined };
  if (index % 5 === 1) return { state: 'disconnected', reason: undefined };
  return { state: 'connected', reason: undefined };
}

/** The connection at `index`, as the host's store lists it (`HostConnection`). */
export function connectionAt(index, { long = false } = {}) {
  const word = WORDS[index % WORDS.length];
  const number = String(index + 1).padStart(3, '0');
  const name = long || index % 8 === 5 ? `${word} ${number} ${TAIL}` : `${word} ${number}`;
  return { plugin: PLUGIN.id, key: keyOf(index), name, detail: index % 3 === 0 ? `Zone ${ZONES[index % ZONES.length]}` : undefined, ...stateOf(index) };
}

/** `count` connections: the first of the world. `long` gives every one a name of more than eighty characters. */
export const connectionsOf = (count, options) => Array.from({ length: count }, (_, index) => connectionAt(index, options));

export { keyOf };
