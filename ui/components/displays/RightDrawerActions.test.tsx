// @vitest-environment jsdom
import React from 'react';
import type * as BaseUI from '@omniviewdev/base-ui';
import { SnackbarProvider, useSnackbar, type DrawerContext } from '@omniviewdev/runtime';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import RightDrawerActions from './RightDrawerActions';

vi.mock('@omniviewdev/base-ui', async importOriginal => ({
  ...(await importOriginal<typeof BaseUI>()),
  useToast: () => ({ toast: vi.fn() }),
}));

afterEach(() => {
  cleanup();
});

function Notices() {
  const { openNotifications, notificationCount } = useSnackbar();
  return <button onClick={openNotifications}>Notices ({notificationCount})</button>;
}

it('keeps an asynchronously rejected drawer action discoverable with its actual diagnostic', async () => {
  const error = Object.assign(new Error('update forbidden'), {
    type: 'omniview:resource/forbidden',
    title: 'Debug denied',
    status: 403,
    detail: 'pods/ephemeralcontainers update forbidden',
    code: 'FORBIDDEN',
  });
  const ctx: DrawerContext = { data: {} };
  render(
    <SnackbarProvider>
      <RightDrawerActions ctx={ctx} actions={[{
        title: 'Debug',
        action: async () => {
          await Promise.resolve();
          throw error;
        },
      }]} />
      <Notices />
    </SnackbarProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Debug' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Notices (1)' }));
  fireEvent.click(screen.getByRole('button', { name: 'Expand details' }));
  expect(screen.getByLabelText('Notifications').querySelector('code')?.textContent)
    .toBe('pods/ephemeralcontainers update forbidden');
});
