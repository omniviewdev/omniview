import { base64Size } from './bytes';

// The output a session holds for the view that draws it (docs/ui-next/status/T1.md, "A hidden terminal"): the base64 text of each chunk exactly as the backend sent it, so a hidden terminal costs a push and a
// size sum per chunk, and nothing is decoded until a view asks. It holds EVERYTHING it is given, in order, and drops nothing: what bounds it is the producer's pacing, not a bound of its own. The host's shell
// stops sending the output of a process that nobody took in at 1 MiB (`ack` in execFeed.ts, docs/ui-next/status/T2a.md), so a terminal nobody reads holds about that much and its process waits; a bound here
// that threw the oldest chunks away cut escape sequences in two and lost what a person had not seen yet.

export type TakenOutput = {
  /** The chunks, oldest first, as base64 text. */
  readonly texts: readonly string[];
  /** The bytes they hold. */
  readonly bytes: number;
};

export type HeldOutput = {
  readonly push: (text: string) => void;
  /**
   * What is held, oldest first, and nothing is held after it: or, given a count of bytes, whole chunks until that count is reached (at least one, so a reader that asks for less than a chunk still makes
   * progress) and the rest stays for the next take.
   */
  readonly take: (max?: number) => TakenOutput;
  /** The bytes held now. */
  readonly bytes: () => number;
  /** Lets go of what is held: a session that was closed has no reader to wait for. */
  readonly clear: () => void;
};

export function createHeldOutput(): HeldOutput {
  let texts: string[] = [];
  // The index of the oldest chunk still held: a partial take moves it, and the array is compacted when the taken part is half of it, so a long backlog read in slices costs O(1) a chunk.
  let first = 0;
  let sizes: number[] = [];
  let held = 0;

  const compact = () => {
    texts = texts.slice(first);
    sizes = sizes.slice(first);
    first = 0;
  };

  return {
    push: (text) => {
      const size = base64Size(text);
      texts.push(text);
      sizes.push(size);
      held += size;
    },
    take: (max) => {
      const live = texts.length - first;
      let count = live;
      let bytes = held;
      if (max !== undefined && max < held) {
        count = 0;
        bytes = 0;
        while (count < live && (count === 0 || bytes < max)) {
          bytes += sizes[first + count] ?? 0;
          count += 1;
        }
      }

      const taken = { texts: texts.slice(first, first + count), bytes };
      held -= bytes;
      first += count;
      if (first === texts.length) {
        texts = [];
        sizes = [];
        first = 0;
      } else if (first > 1024 && first * 2 > texts.length) {
        compact();
      }

      return taken;
    },
    bytes: () => held,
    clear: () => {
      texts = [];
      sizes = [];
      first = 0;
      held = 0;
    },
  };
}
