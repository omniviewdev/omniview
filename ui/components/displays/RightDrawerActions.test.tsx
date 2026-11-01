// @vitest-environment jsdom
import React from 'react';
import type * as BaseUI from '@omniviewdev/base-ui';
import { SnackbarProvider, useSnackbar, type DrawerComponentAction, type DrawerContext } from '@omniviewdev/runtime';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

it('refreshes native choices from external state and disables only the pending native choice', async () => {
  const user = userEvent.setup();
  const ctx: DrawerContext = { data: {} };
  const builtIn = vi.fn();
  const native = vi.fn();
  const listeners = new Set<() => void>();
  let state = { supported: false, pending: false };
  const action: DrawerComponentAction = {
    title: 'Exec',
    externalStore: {
      getSnapshot: () => state,
      subscribe: (_ctx, onChange) => {
        listeners.add(onChange);
        return () => {
          listeners.delete(onChange); 
        };
      },
    },
    list: () => [
      { title: 'app', action: builtIn },
      ...(state.supported ? [{
        title: 'app — Open in Native Terminal',
        disabled: state.pending,
        action: native,
      }] : []),
    ],
  };
  const view = render(<SnackbarProvider><RightDrawerActions ctx={ctx} actions={[action]} /></SnackbarProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Exec' }));
  expect(builtIn).toHaveBeenCalledTimes(1);
  act(() => {
    state = { supported: true, pending: false };
    listeners.forEach((listener) => {
      listener(); 
    });
  });
  const trigger = screen.getByRole('button', { name: 'Exec' });
  expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
  await user.hover(trigger);
  const nativeChoice = await screen.findByRole('menuitem', { name: 'app — Open in Native Terminal' });
  act(() => {
    state = { supported: true, pending: true };
    listeners.forEach((listener) => {
      listener(); 
    });
  });
  expect(nativeChoice.getAttribute('aria-disabled')).toBe('true');
  expect(screen.getByRole('menuitem', { name: 'app' }).getAttribute('aria-disabled')).not.toBe('true');
  fireEvent.click(nativeChoice);
  expect(native).not.toHaveBeenCalled();
  act(() => {
    state = { supported: true, pending: false };
    listeners.forEach((listener) => {
      listener(); 
    });
  });
  fireEvent.click(screen.getByRole('menuitem', { name: 'app — Open in Native Terminal' }));
  expect(native).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(listeners.size).toBe(0);
});

it('disables a direct single-item action while its choice is pending', () => {
  const action = vi.fn();
  render(<SnackbarProvider><RightDrawerActions ctx={{ data: {} }} actions={[{
    title: 'Exec',
    list: [{ title: 'app — Open in Native Terminal', disabled: true, action }],
  }]} /></SnackbarProvider>);
  const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Exec' });
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(action).not.toHaveBeenCalled();
});
