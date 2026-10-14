import '@omniviewdev/ui/theme/tokens.css';
import '@/theme/base-ui.css';

import { installFakeBackend } from './harness/backend';
import { installDefaultFixtures } from './fixtures/defaults';

// The app logs a lot at debug/info level. Browser-mode Vitest forwards every
// console call to the terminal over RPC, which would dominate the timings.
if (import.meta.env.BENCH_VERBOSE !== '1') {
  const noop = () => {};
  console.log = noop;
  console.debug = noop;
  console.info = noop;

  // Repeated warnings from app code (e.g. the LogViewer's follow-mode
  // scrollToIndex giving up while the drawer is being dragged) would otherwise
  // flood the output with hundreds of identical lines. Show each message once,
  // then only at 10, 100, 1000 repeats.
  const seen = new Map<string, number>();
  for (const level of ['warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      const key = level + ':' + args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ');
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      if (n === 1) original(...args);
      else if (Number.isInteger(Math.log10(n))) original(`(repeated ${n} times)`, ...args);
    };
  }
}

installFakeBackend();
installDefaultFixtures();
