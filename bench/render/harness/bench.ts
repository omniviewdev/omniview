import { bench, type BenchOptions } from 'vitest';

export interface ScreenBenchOptions {
  /** Minimum measured iterations. */
  iterations?: number;
  /** Minimum measuring time in ms (tinybench keeps going until both are met). */
  time?: number;
  warmupIterations?: number;
  setup?: () => void | Promise<void>;
  teardown?: () => void | Promise<void>;
}

// CI runners are slow and noisy; keep the per-bench budget bounded but stable.
const QUICK = import.meta.env.BENCH_QUICK === '1';

/**
 * vitest `bench` with defaults sized for whole-screen work, and errors logged
 * loudly (tinybench otherwise records a failed task as "0 samples" silently).
 * report.mjs fails the run when any bench has no samples.
 */
export function screenBench(name: string, fn: () => void | Promise<void>, opts: ScreenBenchOptions = {}): void {
  const { setup, teardown, iterations = 10, time = 1500, warmupIterations = 2 } = opts;
  const wrap = (label: string, f?: () => void | Promise<void>) =>
    f && (async () => {
      try {
        await f();
      } catch (err) {
        console.error(`[bench] ${name} ${label} failed:`, err);
        throw err;
      }
    });
  const options: BenchOptions = {
    iterations: QUICK ? Math.min(iterations, 3) : iterations,
    time: QUICK ? 0 : time,
    warmupIterations: QUICK ? 1 : warmupIterations,
    warmupTime: 0,
    setup: wrap('setup', setup) as BenchOptions['setup'],
    teardown: wrap('teardown', teardown) as BenchOptions['teardown'],
  };
  bench(name, wrap('run', fn)!, options);
}
