// @vitest-environment jsdom
import React from 'react';
import { ToastProvider } from '@omniviewdev/base-ui';
import { ActivityProvider, ActivitySurfaces, useNotifications, type ActivityRecord, type DrawerComponentAction, type DrawerContext } from '@omniviewdev/runtime';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import RightDrawerActions from './RightDrawerActions';

const activity = vi.hoisted(() => ({ heartbeat: vi.fn(), subscribe: vi.fn(), attach: vi.fn(), unsubscribe: vi.fn(), listen: vi.fn(), listenObservationErrors: vi.fn(), publishMessage: vi.fn(), setPresentation: vi.fn() }));
vi.mock('../../../packages/omniviewdev-runtime/src/activity/client', () => ({ activityClient: activity }));
let records: ActivityRecord[];
let revision: number;
beforeEach(() => {
  vi.resetAllMocks();
  records = []; revision = 0;
  activity.heartbeat.mockResolvedValue(undefined);
  activity.unsubscribe.mockResolvedValue(undefined);
  activity.subscribe.mockImplementation(async () => ({ id: 'view', snapshot: { revision, records: [...records] } }));
  activity.attach.mockImplementation(async () => ({ revision, records: [...records] }));
  activity.listen.mockReturnValue(() => undefined);
  activity.listenObservationErrors.mockReturnValue(() => undefined);
  activity.publishMessage.mockImplementation(async spec => {
    const record: ActivityRecord = { id: `notice-${++revision}`, revision, source: {}, kind: 'message', severity: spec.severity, presentation: spec.presentation, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), visibility: { collapsed: false, toastDismissed: false, read: false } };
    records.push(record);
    return record;
  });
  activity.setPresentation.mockImplementation(async patch => {
    const current = records.find(record => record.id === patch.id)!;
    const record = { ...current, revision: ++revision, visibility: { ...current.visibility, ...patch } };
    records = records.map(value => value.id === record.id ? record : value);
    return record;
  });
});
function ActivityTestRoot({ children }: { children: React.ReactNode }) {
  return <ToastProvider><ActivityProvider>{children}<ActivitySurfaces /></ActivityProvider></ToastProvider>;
}

afterEach(() => {
  cleanup();
});

function Notices() {
  const { openNotifications, notificationCount } = useNotifications();
  return <button onClick={() => openNotifications()}>Notices ({notificationCount})</button>;
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
    <ActivityTestRoot>
      <RightDrawerActions ctx={ctx} actions={[{
        title: 'Debug',
        action: async () => {
          await Promise.resolve();
          throw error;
        },
      }]} />
      <Notices />
    </ActivityTestRoot>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Debug' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Notices (1)' }));
  fireEvent.click(screen.getByRole('button', { name: 'Details' }));
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
  const view = render(<ActivityTestRoot><RightDrawerActions ctx={ctx} actions={[action]} /></ActivityTestRoot>);
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
  render(<ActivityTestRoot><RightDrawerActions ctx={{ data: {} }} actions={[{
    title: 'Exec',
    list: [{ title: 'app — Open in Native Terminal', disabled: true, action }],
  }]} /></ActivityTestRoot>);
  const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Exec' });
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(action).not.toHaveBeenCalled();
});

it.each([1, 2])('keeps split primary and options distinct with %i targets', async (count) => {
  const user = userEvent.setup();
  const start = vi.fn();
  const options = vi.fn();
  const targets = Array.from({ length: count }, (_, i) => `app-${i}`);
  render(<ActivityTestRoot><RightDrawerActions ctx={{}} actions={[{
    title: 'Debug',
    list: targets.map(title => ({ title, action: start })),
    splitMenu: {
      title: 'Debug options',
      list: targets.map(title => ({ title, action: options })),
    },
  }]} /></ActivityTestRoot>);
  await user.click(screen.getByRole('button', { name: 'Debug options' }));
  expect(start).not.toHaveBeenCalled();
  expect(options).not.toHaveBeenCalled();
  await user.click(await screen.findByRole('menuitem', { name: 'app-0' }));
  expect(options).toHaveBeenCalledTimes(1);
  expect(start).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Debug' }));
  if (count > 1) {
    expect(start).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('menuitem', { name: 'app-0' }));
  }

  expect(start).toHaveBeenCalledTimes(1);
  expect(options).toHaveBeenCalledTimes(1);
});

it('disables a split primary without an action while keeping its options usable', async () => {
  const user = userEvent.setup();
  const ctx: DrawerContext = { data: {} };
  const options = vi.fn();
  render(<ActivityTestRoot><RightDrawerActions ctx={ctx} actions={[{
    title: 'Debug',
    splitMenu: { title: 'Debug options', list: [{ title: 'Configure debug', action: options }] },
  }]} /></ActivityTestRoot>);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Debug' }).disabled).toBe(true);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Debug options' }).disabled).toBe(false);
  await user.click(screen.getByRole('button', { name: 'Debug options' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Configure debug' }));
  expect(options).toHaveBeenCalledExactlyOnceWith(ctx);
});

it('disables split choices independently and reports option errors', async () => {
  const user = userEvent.setup();
  const start = vi.fn();
  const options = vi.fn().mockRejectedValue(new Error('debug options denied'));
  const descriptor: DrawerComponentAction = {
    title: 'Debug',
    list: [{ title: 'app', action: start, disabled: true }],
    splitMenu: { title: 'Debug options', list: [{ title: 'app', action: options }] },
  };
  const view = render(<ActivityTestRoot>
    <RightDrawerActions ctx={{}} actions={[descriptor]} /><Notices />
  </ActivityTestRoot>);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Debug' }).disabled).toBe(true);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Debug options' }).disabled).toBe(false);
  await user.click(screen.getByRole('button', { name: 'Debug options' }));
  await user.click(await screen.findByRole('menuitem', { name: 'app' }));
  expect(await screen.findByRole('button', { name: 'Notices (1)' })).toBeTruthy();
  expect(start).not.toHaveBeenCalled();
  view.rerender(<ActivityTestRoot><RightDrawerActions ctx={{}} actions={[{
    ...descriptor, enabled: false,
  }]} /></ActivityTestRoot>);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Debug' }).disabled).toBe(true);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Debug options' }).disabled).toBe(true);
});
