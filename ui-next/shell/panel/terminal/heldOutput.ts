import { base64Size } from './bytes';

// The output a session holds for the view that draws it (docs/ui-next/status/T1.md, "A hidden terminal"): the base64 text of each chunk exactly as the backend sent it, so a hidden terminal costs a push and
// a size sum per chunk, and nothing is decoded until a view asks. Bounded in bytes: past the bound the OLDEST chunks are dropped and counted, whole chunks only (a chunk is a pty read, and the emulator
// recovers from a sequence cut at a read; it cannot recover from a sequence cut inside one). The newest chunk is always kept: a bound that dropped the last thing the process wrote would leave the screen blank.

export type TakenOutput = {
  /** The chunks, oldest first, as base64 text. */
  readonly texts: readonly string[];
  /** The bytes they hold. */
  readonly bytes: number;
  /** The bytes dropped past the bound since the last take. */
  readonly dropped: number;
};

export type HeldOutput = {
  readonly push: (text: string) => void;
  /**
   * What is held, oldest first, and nothing is held after it: or, given a count of bytes, whole chunks until that count is reached (at least one, so a reader that asks for less than a chunk still makes
   * progress) and the rest stays for the next take. The drops since the last take are reported once, with whatever the first take after them is.
   */
  readonly take: (max?: number) => TakenOutput;
  /** The bytes held now. */
  readonly bytes: () => number;
  /** Lets go of what is held (the drop count with it): a session that ended has no reader to wait for. */
  readonly clear: () => void;
};

export function createHeldOutput(limit: number): HeldOutput {
  let texts: string[] = [];
  // The index of the oldest chunk still held: a drop moves it, and the array is compacted when the dropped part is half of it, so a flood past the bound costs O(1) a chunk.
  let first = 0;
  let sizes: number[] = [];
  let held = 0;
  let dropped = 0;

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
      while (held > limit && texts.length - first > 1) {
        const gone = sizes[first] ?? 0;
        held -= gone;
        dropped += gone;
        first += 1;
      }

      if (first > 1024 && first * 2 > texts.length) {
        compact();
      }
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

      const taken = { texts: texts.slice(first, first + count), bytes, dropped };
      dropped = 0;
      held -= bytes;
      first += count;
      if (first === texts.length) {
        texts = [];
        sizes = [];
        first = 0;
      }

      return taken;
    },
    bytes: () => held,
    clear: () => {
      texts = [];
      sizes = [];
      first = 0;
      held = 0;
      dropped = 0;
    },
  };
}
