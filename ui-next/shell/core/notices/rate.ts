import { LIMITS } from './types';

// A plugin cannot flood the user (ch16 S82: more than twenty records a minute from one plugin are folded into one row; the lead's brief adds a bound per second). A source's hits are counted in
// sixty one-second slots, so a hit costs the same however many came before it: ten thousand in one tick are ten thousand increments. Every hit counts, the refused ones too: a source that keeps
// flooding stays folded until it has been quiet for a minute, and does not slip one through every few seconds.

const SLOTS = 60;

type Slots = {
  /** The second (since the epoch) each slot was last used for. */
  readonly seconds: number[];
  readonly counts: number[];
};

export type Rate = {
  /** Counts one record of a source at `now` (milliseconds since the epoch) and says whether it is over the limit. */
  readonly hit: (source: string, now: number) => boolean;
  readonly forget: (source: string) => void;
  /** Sources being counted. */
  readonly size: () => number;
};

export function createRate(limits: { readonly perSecond: number; readonly perMinute: number } = LIMITS): Rate {
  const sources = new Map<string, Slots>();

  return {
    hit: (source, now) => {
      const second = Math.floor(now / 1000);
      const slot = second % SLOTS;
      let slots = sources.get(source);
      if (slots === undefined) {
        slots = { seconds: Array.from({ length: SLOTS }, () => Number.NEGATIVE_INFINITY), counts: Array.from({ length: SLOTS }, () => 0) };
        sources.set(source, slots);
      }

      if (slots.seconds[slot] !== second) {
        slots.seconds[slot] = second;
        slots.counts[slot] = 0;
      }

      slots.counts[slot] = (slots.counts[slot] ?? 0) + 1;
      let minute = 0;
      for (let index = 0; index < SLOTS; index += 1) {
        if ((slots.seconds[index] ?? Number.NEGATIVE_INFINITY) > second - SLOTS) {
          minute += slots.counts[index] ?? 0;
        }
      }

      return (slots.counts[slot] ?? 0) > limits.perSecond || minute > limits.perMinute;
    },
    forget: (source) => {
      sources.delete(source);
    },
    size: () => sources.size,
  };
}
