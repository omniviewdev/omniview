import type { Scheduler } from '../core/fields';

// The clock Settings runs on in a page: the browser's timers and the time of day. The model (`model/`) touches no timer and no global of its own: it runs on the scheduler it is given, which a test makes a manual clock.

export const pageClock: Scheduler = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};
