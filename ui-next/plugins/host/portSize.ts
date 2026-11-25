// What a request weighs, for the bounds of a forward (`portForward.ts`, PF2): the bytes its JSON takes in UTF-8, as the runtime's encoder sends them (`packages/omniviewdev-runtime/src/resource/v2/requestJSON.ts`), counted by a walk that has
// a budget and gives up at the first excess. A value that is far too large is never serialised and is not read to its end: a text is refused by its length before a character of it is looked at, and a list or a map is read only as far as
// the budget goes (each member costs a byte at least, so a list of a billion holes is read a few thousand members deep, not a billion). Nothing is built while it walks, so a refusal costs nothing but the walk.

/** Why a value could not be weighed within what it was given. */
export type Overrun =
  /** It is larger than the budget. */
  | 'over'
  /** It nests deeper than the runtime's encoder takes, which a value that refers to itself does without end. */
  | 'deep'
  /** A text in it is longer than the bound on texts. */
  | 'text';

/** How deep the runtime's encoder takes a value to nest: a node that is more than this many levels below the root is refused. */
export const MAX_DEPTH = 64;

/** Whether a value is something with members of its own: not a list, which the walk reads by position, and not `null`. */
const isMap = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/**
 * What `value` weighs: the bytes its JSON takes in UTF-8, or why it cannot be said within `budget` bytes. The root is level 0. A member that is `undefined`, a function or a symbol is left out of a map, as JSON leaves it, and is
 * `null` in a list; a negative zero is `-0`, as the encoder sends it, and a number that is not finite is `null`. A text that is longer than `text` characters, a name included, is `'text'` (which is said before `'over'`, as it names
 * what is wrong); with no bound given there is none.
 */
export function weigh(value: unknown, budget: number): number | Exclude<Overrun, 'text'>;
export function weigh(value: unknown, budget: number, text: number): number | Overrun;
export function weigh(value: unknown, budget: number, text = Number.POSITIVE_INFINITY): number | Overrun {
  let left = budget;

  /** Spends `bytes` of what is left; whether there was that much. */
  const spend = (bytes: number): boolean => {
    left -= bytes;
    return left >= 0;
  };

  /** What a text takes as JSON, or why that cannot be said. */
  const weighText = (characters: string): number | Overrun => {
    if (characters.length > text) {
      return 'text';
    }

    // A character takes a byte at least, and the quotes two: a text that cannot fit is not read.
    if (characters.length + 2 > left) {
      return 'over';
    }

    let bytes = 2;
    for (let index = 0; index < characters.length; index += 1) {
      const unit = characters.charCodeAt(index);
      if (unit < 0x20) {
        // JSON writes a backspace, a tab, a line feed, a form feed and a carriage return in two bytes, and any other control character as `\u00xx`.
        bytes += unit === 8 || unit === 9 || unit === 10 || unit === 12 || unit === 13 ? 2 : 6;
      } else if (unit === 0x22 || unit === 0x5c) {
        bytes += 2;
      } else if (unit < 0x80) {
        bytes += 1;
      } else if (unit < 0x800) {
        bytes += 2;
      } else if (unit >= 0xd800 && unit <= 0xdbff && characters.charCodeAt(index + 1) >= 0xdc00 && characters.charCodeAt(index + 1) <= 0xdfff) {
        // Two units of a character outside the first plane: four bytes.
        bytes += 4;
        index += 1;
      } else if (unit >= 0xd800 && unit <= 0xdfff) {
        // A unit that is half a character: JSON writes it as an escape, and the runtime's encoder refuses it.
        bytes += 6;
      } else {
        bytes += 3;
      }
    }

    return bytes;
  };

  const visitList = (list: readonly unknown[], depth: number): Overrun | undefined => {
    for (let index = 0; index < list.length; index += 1) {
      if (index > 0 && !spend(1)) {
        return 'over';
      }

      const failed = visit(list[index], depth + 1);
      if (failed !== undefined) {
        return failed;
      }
    }

    return undefined;
  };

  const visitMap = (map: Readonly<Record<string, unknown>>, depth: number): Overrun | undefined => {
    let first = true;
    // `for in` reads a name at a time, so a map of millions of members is read only as far as the budget goes; the members a map inherits are not its own.
    for (const name in map) {
      if (!Object.hasOwn(map, name)) {
        continue;
      }

      const member: unknown = Reflect.get(map, name);
      if (member === undefined || typeof member === 'function' || typeof member === 'symbol') {
        continue;
      }

      if (!first && !spend(1)) {
        return 'over';
      }

      first = false;
      const named = weighText(name);
      if (typeof named !== 'number') {
        return named;
      }

      // The name, and the colon after it.
      if (!spend(named + 1)) {
        return 'over';
      }

      const failed = visit(member, depth + 1);
      if (failed !== undefined) {
        return failed;
      }
    }

    return undefined;
  };

  const visit = (node: unknown, depth: number): Overrun | undefined => {
    if (depth > MAX_DEPTH) {
      return 'deep';
    }

    if (typeof node === 'string') {
      const bytes = weighText(node);
      if (typeof bytes !== 'number') {
        return bytes;
      }

      return spend(bytes) ? undefined : 'over';
    }

    if (typeof node === 'number') {
      return spend(Number.isFinite(node) ? (Object.is(node, -0) ? 2 : String(node).length) : 4) ? undefined : 'over';
    }

    if (typeof node === 'boolean') {
      return spend(node ? 4 : 5) ? undefined : 'over';
    }

    if (Array.isArray(node)) {
      // The brackets.
      return spend(2) ? visitList(node, depth) : 'over';
    }

    if (isMap(node)) {
      // The braces.
      return spend(2) ? visitMap(node, depth) : 'over';
    }

    // `null`, and what a list writes as `null` for a member that has no form of JSON's own (`undefined`, a function, a symbol, a bigint).
    return spend(4) ? undefined : 'over';
  };

  return visit(value, 0) ?? budget - left;
}
