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
}

installFakeBackend();
installDefaultFixtures();
