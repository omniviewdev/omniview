// The output a session holds for the view that draws it (docs/ui-next/status/T1.md, "A hidden terminal"): the bytes of each frame exactly as the host sent them, so a hidden terminal costs a push and a size sum per frame,
// and nothing is copied or decoded until a view asks. It holds EVERYTHING it is given, in order, and drops nothing: what bounds it is the host's flow control, not a bound of its own. The host stops sending the output of a
// terminal that nobody took in once a window of it is unacknowledged (`ack` in execFeed.ts), so a terminal nobody reads holds about that much and its shell waits; a bound here that threw the oldest chunks away cut escape
// sequences in two and lost what a person had not seen yet.

import type { PlacedMark, TerminalMark } from './feed';

export type TakenOutput = {
  /** The chunks, oldest first, as the arrays that were pushed. */
  readonly chunks: readonly Uint8Array[];
  /** The bytes they hold. */
  readonly bytes: number;
  /** The marks that fall in them, each with the bytes before it: absent when there is none. */
  readonly marks?: readonly PlacedMark[] | undefined;
};

export type HeldOutput = {
  readonly push: (bytes: Uint8Array) => void;
  /**
   * What is held, oldest first, and nothing is held after it: or, given a count of bytes, whole chunks until that count is reached (at least one, so a reader that asks for less than a chunk still makes
   * progress) and the rest stays for the next take.
   */
  readonly take: (max?: number) => TakenOutput;
  /**
   * A mark stands in the output, `behind` bytes before the end of what was pushed (0: right after the last byte). What is taken is cut at the mark, so that a reader that writes it and waits for the parse stands exactly at
   * the mark when it creates its marker; the mark is handed over with the bytes that end at it, or, when all of them were taken already, with the next take (which may then hold no bytes). `behind` beyond what is held is
   * the start of what is held.
   */
  readonly mark: (mark: TerminalMark, behind: number) => void;
  /** The bytes held now. */
  readonly bytes: () => number;
  /** Lets go of what is held: a session that was closed has no reader to wait for. */
  readonly clear: () => void;
};

export function createHeldOutput(): HeldOutput {
  let chunks: Uint8Array[] = [];
  // The index of the oldest chunk still held: a partial take moves it, and the array is compacted when the taken part is half of it, so a long backlog read in slices costs O(1) a chunk.
  let first = 0;
  let held = 0;
  // Bytes ever pushed and ever taken (or let go of): a mark's place is one of these counts, so that it does not move while the chunks do.
  let pushed = 0;
  let taken = 0;
  // The marks that wait for their bytes to be taken, in order, each at a count of bytes; `firstMark` is the oldest that was not handed over (the array is compacted as the chunks are).
  let waiting: Array<{ readonly mark: TerminalMark; readonly at: number }> = [];
  let firstMark = 0;

  const compact = () => {
    chunks = chunks.slice(first);
    first = 0;
  };

  return {
    push: (bytes) => {
      chunks.push(bytes);
      held += bytes.length;
      pushed += bytes.length;
    },
    mark: (mark, behind) => {
      waiting.push({ mark, at: Math.max(taken, pushed - Math.max(0, behind)) });
    },
    take: (max) => {
      const before = taken;
      // The bytes are cut where the next mark that stands after them is: the reader parses up to it and makes its marker there.
      let limit = Infinity;
      for (let index = firstMark; index < waiting.length; index += 1) {
        const at = waiting[index]?.at ?? 0;
        if (at > before) {
          limit = at;
          break;
        }
      }

      const live = chunks.length - first;
      let bytes = held;
      let taking: Uint8Array[];
      if (limit === Infinity && (max === undefined || max >= held)) {
        taking = chunks.slice(first);
        first = chunks.length;
      } else {
        taking = [];
        bytes = 0;
        let index = first;
        while (index < first + live) {
          if (taking.length > 0 && max !== undefined && bytes >= max) {
            break;
          }

          const room = limit - (before + bytes);
          if (room <= 0) {
            break;
          }

          const chunk = chunks[index] ?? new Uint8Array(0);
          if (chunk.length > room) {
            // The mark stands inside this chunk (a host that did not cut where the protocol says): its head is taken, its tail stays, and no byte is lost.
            taking.push(chunk.subarray(0, room));
            chunks[index] = chunk.subarray(room);
            bytes += room;
            break;
          }

          taking.push(chunk);
          bytes += chunk.length;
          index += 1;
        }

        first = index;
      }

      held -= bytes;
      taken += bytes;
      const placed: PlacedMark[] = [];
      while (firstMark < waiting.length && (waiting[firstMark]?.at ?? Infinity) <= taken) {
        const one = waiting[firstMark];
        if (one !== undefined) {
          placed.push({ mark: one.mark, at: Math.max(0, one.at - before) });
        }

        firstMark += 1;
      }

      if (firstMark === waiting.length) {
        waiting = [];
        firstMark = 0;
      } else if (firstMark > 1024 && firstMark * 2 > waiting.length) {
        waiting = waiting.slice(firstMark);
        firstMark = 0;
      }

      if (first === chunks.length) {
        chunks = [];
        first = 0;
      } else if (first > 1024 && first * 2 > chunks.length) {
        compact();
      }

      return placed.length === 0 ? { chunks: taking, bytes } : { chunks: taking, bytes, marks: placed };
    },
    bytes: () => held,
    clear: () => {
      chunks = [];
      first = 0;
      taken += held;
      held = 0;
      waiting = [];
      firstMark = 0;
    },
  };
}
