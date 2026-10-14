/**
 * The real <App /> (all providers, router, header, sidebar, footer, welcome
 * page) mounted repeatedly. App keeps module-level singletons (query client,
 * redux store), so iterations after the first see warm caches: this measures
 * shell render cost, not cold start (see the cold-start script for that).
 */
import { describe } from 'vitest';
import App from '@/App';

import { screenBench } from './harness/bench';
import { hasText, mount, waitFor } from './harness/dom';

describe('app shell', () => {
  screenBench('mount App until welcome page', async () => {
    window.location.hash = '#/';
    const m = mount(<App />);
    await waitFor(() => {
      const main = m.container.querySelector('[data-testid="app-main-content"]') ?? m.container.querySelector('main');
      return main && hasText(main, 'The IDE for');
    }, { label: 'welcome page in main content' });
    m.unmount();
  });
});
