import { test } from 'vitest';

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
 * Register a Vitest test using its benchmark fixture with whole-screen defaults.
 * Log workload and lifecycle errors before Vitest fails the test.
 * report.mjs also rejects failed tests and benchmarks without samples.
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
  test(name, async ({ bench }) => {
    await bench(name, {
      beforeAll: wrap('setup', setup),
      afterAll: wrap('teardown', teardown),
    }, wrap('run', fn)!).run({
      iterations: QUICK ? Math.min(iterations, 3) : iterations,
      time: QUICK ? 0 : time,
      warmupIterations: QUICK ? 1 : warmupIterations,
      warmupTime: 0,
    });
  });
}
