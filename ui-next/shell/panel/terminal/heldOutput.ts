// The output a session holds for the view that draws it (docs/ui-next/status/T1.md, "A hidden terminal"): the bytes of each frame exactly as the host sent them, so a hidden terminal costs a push and a size sum per frame,
// and nothing is copied or decoded until a view asks. It holds EVERYTHING it is given, in order, and drops nothing: what bounds it is the host's flow control, not a bound of its own. The host stops sending the output of a
// terminal that nobody took in once a window of it is unacknowledged (`ack` in execFeed.ts), so a terminal nobody reads holds about that much and its shell waits; a bound here that threw the oldest chunks away cut escape
// sequences in two and lost what a person had not seen yet.

export type TakenOutput = {
  /** The chunks, oldest first, as the arrays that were pushed. */
  readonly chunks: readonly Uint8Array[];
  /** The bytes they hold. */
  readonly bytes: number;
};

export type HeldOutput = {
  readonly push: (bytes: Uint8Array) => void;
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
  let chunks: Uint8Array[] = [];
  // The index of the oldest chunk still held: a partial take moves it, and the array is compacted when the taken part is half of it, so a long backlog read in slices costs O(1) a chunk.
  let first = 0;
  let held = 0;

  const compact = () => {
    chunks = chunks.slice(first);
    first = 0;
  };

  return {
    push: (bytes) => {
      chunks.push(bytes);
      held += bytes.length;
    },
    take: (max) => {
      const live = chunks.length - first;
      let count = live;
      let bytes = held;
      if (max !== undefined && max < held) {
        count = 0;
        bytes = 0;
        while (count < live && (count === 0 || bytes < max)) {
          bytes += chunks[first + count]?.length ?? 0;
          count += 1;
        }
      }

      const taken = { chunks: chunks.slice(first, first + count), bytes };
      held -= bytes;
      first += count;
      if (first === chunks.length) {
        chunks = [];
        first = 0;
      } else if (first > 1024 && first * 2 > chunks.length) {
        compact();
      }

      return taken;
    },
    bytes: () => held,
    clear: () => {
      chunks = [];
      first = 0;
      held = 0;
    },
  };
}
