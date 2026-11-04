// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type * as Runtime from '@omniviewdev/runtime';
import type { ActionDescriptor, ActivityAction, ActivityRecord } from '@omniviewdev/runtime';
import { ActivityActionSurfaces } from './ActivityActionSurfaces';

const native = vi.hoisted(() => ({ getActions: vi.fn(), start: vi.fn() }));
const request: Runtime.ActionRequest = {
  action: 'resize',
  route: { connection: 'local-vms' },
  reference: {
    address: { provider: 'local', authority: 'vm', type: 'vm', id: 'worker-03', scope: [] },
    incarnation: 'vm-generation-1',
  },
  input: { kind: 'map', value: { capacity: { kind: 'int64', value: '120' } } },
};
const action: ActivityAction = {
  id: 'resize',
  kind: 'resource-action',
  label: 'Expand disk',
  intent: { pluginID: 'virtualization', request },
};
const record: ActivityRecord = {
  id: 'disk-alert',
  revision: 1,
  kind: 'alert',
  severity: 'warning',
  source: {},
  createdAt: '2026-11-03T00:00:00Z',
  updatedAt: '2026-11-03T00:00:00Z',
  presentation: { title: 'Low disk', actions: [action] },
  visibility: { collapsed: true, toastDismissed: true, read: false },
  alert: { key: 'disk', state: 'firing', occurrences: 1 },
};
vi.mock('@omniviewdev/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof Runtime>()),
  useActivityActions: () => ({ startResourceAction: native.start }),
  withConnectionReady: async (_plugin: string, _connection: string, run: () => Promise<unknown>) =>
    run(),
  ActivitySurfaces: ({
    onAction,
  }: {
    onAction: (action: ActivityAction, record: ActivityRecord) => Promise<void>;
  }) => (
    <button
      onClick={() => {
        void onAction(action, record);
      }}
    >
      Review resize
    </button>
  ),
}));
vi.mock('@omniviewdev/runtime/api', () => ({ ResourceClient: { GetActions: native.getActions } }));

function descriptor(requiredConfirmation = false): ActionDescriptor {
  return {
    id: 'resize',
    label: 'Expand disk',
    description: '',
    icon: '',
    scope: 'instance',
    streaming: true,
    dangerous: requiredConfirmation,
    paramsSchema: {
      properties: {
        capacity: { type: 'integer', minimum: 81 },
        ...(requiredConfirmation ? { reason: { type: 'string' as const } } : {}),
      },
      required: requiredConfirmation ? ['capacity', 'reason'] : ['capacity'],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  native.getActions.mockResolvedValue([descriptor()]);
  native.start.mockResolvedValue({ ...record, id: 'resize-task', kind: 'task' });
});
afterEach(cleanup);

it('requires fresh parameter review after descriptor drift and never auto-replays the mutation', async () => {
  native.start.mockRejectedValueOnce({
    type: 'omniview:resource/reset-required',
    status: 409,
    title: 'Action changed',
    detail: 'Review the updated action.',
    code: 'RESET_REQUIRED',
    recovery: 'refreshContract',
  });
  render(<ActivityActionSurfaces />);
  fireEvent.click(screen.getByText('Review resize'));
  const submit = await screen.findByRole<HTMLButtonElement>('button', { name: 'Expand disk' });
  fireEvent.click(submit);
  await screen.findByText('Review the updated action.');
  expect(submit.disabled).toBe(true);
  native.getActions.mockResolvedValue([descriptor(true)]);
  fireEvent.click(screen.getByText('Review updated action'));
  const reason = await screen.findByLabelText('reason *');
  expect(native.start).toHaveBeenCalledTimes(1);
  fireEvent.change(reason, { target: { value: 'Capacity alert reviewed' } });
  fireEvent.click(screen.getByRole('button', { name: 'Expand disk' }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull(); 
  });
  expect(native.start).toHaveBeenCalledTimes(2);
});

it('locks submission while admission is pending and does not duplicate a mutation', async () => {
  const admission = Promise.withResolvers<ActivityRecord>();
  native.start.mockReturnValue(admission.promise);
  render(<ActivityActionSurfaces />);
  fireEvent.click(screen.getByText('Review resize'));
  const submit = await screen.findByRole<HTMLButtonElement>('button', { name: 'Expand disk' });
  fireEvent.click(submit);
  fireEvent.click(submit);
  await waitFor(() => {
    expect(submit.disabled).toBe(true); 
  });
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Cancel' }).disabled).toBe(true);
  expect(native.start).toHaveBeenCalledTimes(1);
  admission.resolve({ ...record, id: 'accepted-task', kind: 'task' });
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull(); 
  });
});
