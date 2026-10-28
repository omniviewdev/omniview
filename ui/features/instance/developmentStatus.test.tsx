import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import InstanceIndicator from '@/components/displays/Footer/InstanceIndicator';
import { hostStatus, parseDevelopmentStatus } from './developmentStatus';

const host = vi.hoisted(() => ({
  identity: { kind: 'development', displayName: 'main', instanceID: 'instance', generation: 'generation' },
  info: { workspaceID: 'workspace', generation: 'generation', readiness: 'host-ready', endpoints: { browser: null as string | null }, repositories: [] },
  status: 'confirmed',
  refreshInfo: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));
vi.mock('./InstanceContext', () => ({ useInstance: () => host }));

const payload = {
  workspaceID: 'workspace', generation: 'generation', phase: 'ready',
  health: { build: 'ready', hmr: 'connected', servedSource: 'current', sourceReload: 'unverified', readiness: 'authenticated', dependencies: 'current' },
  builds: {}, selectedPluginCount: 2,
};
const parse = (value: unknown) => parseDevelopmentStatus(value, 'workspace', 'generation');

afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); host.status = 'confirmed'; host.info.readiness = 'host-ready'; host.info.endpoints.browser = null; host.refreshInfo.mockReset(); 
});

describe('host status boundaries', () => {
  it('requires matching workspace and generation', () => {
    expect(parse({ ...payload, workspaceID: 'foreign' })).toBeNull();
    expect(parse({ ...payload, generation: 'old' })).toBeNull();
    expect(parse(null)).toBeNull();
    expect(parse({ ...payload, phase: 1 })).toBeNull();
  });
  it('never treats missing status or unconfirmed identity as ready', () => {
    expect(hostStatus(null, true).tone).toBe('neutral');
    expect(hostStatus(parse(payload), false).tone).toBe('neutral');
    expect(hostStatus(parse(payload), true).tone).toBe('success');
    expect(hostStatus(parse({ ...payload, health: {} }), true).tone).toBe('neutral');
  });
  it('prioritizes failure over building and readiness', () => {
    expect(hostStatus(parse({ ...payload, failedStage: 'host-backend' }), true).tone).toBe('danger');
    expect(hostStatus(parse({ ...payload, builds: { host: { phase: 'invalidated' } } }), true).tone).toBe('danger');
    expect(hostStatus(parse({ ...payload, builds: { host: { phase: 'building' } } }), true).tone).toBe('warning');
    expect(hostStatus(parse({ ...payload, health: { servedSource: 'stale' } }), true).tone).toBe('neutral');
    expect(hostStatus(parse({ ...payload, phase: 'stopped' }), true).tone).toBe('neutral');
  });
  it('does not infer selected plugin counts from repositories or accept invalid counts', () => {
    expect(parse({ ...payload, selectedPluginCount: -1 })?.selectedPluginCount).toBeNull();
    expect(parse({ ...payload, selectedPluginCount: 1.5 })?.selectedPluginCount).toBeNull();
    expect(parse({ ...payload, selectedPluginCount: 0 })?.selectedPluginCount).toBe(0);
  });
});

it.each([
  ['http://127.0.0.1:41000', 'Ready'],
  [null, 'Unavailable'],
])('requires browser endpoint evidence for backend-ready identity (%s)', async (endpoint, label) => {
  host.info.readiness = 'backend-ready';
  host.info.endpoints.browser = endpoint;
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => payload })));
  render(<InstanceIndicator />);
  await waitFor(() => {
    expect(fetch).toHaveBeenCalledOnce(); 
  });
  await act(async () => {
    await Promise.resolve(); 
  });
  expect(await screen.findByRole('button', { name: `DEV · main · ${label}` })).toBeVisible();
});

it('shows independent host observations and retains full details access', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => payload })));
  render(<InstanceIndicator />);
  fireEvent.click(await screen.findByRole('button', { name: 'DEV · main · Ready' }));
  expect(await screen.findByText('Source reload proof')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Full instance details' }));
  expect(await screen.findByRole('dialog')).toBeVisible();
  expect(screen.getByText('instance')).toBeVisible();
  expect(host.refreshInfo).toHaveBeenCalledOnce();
});

it('keeps full details open while host identity refresh clears the status snapshot', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => payload })));
  host.refreshInfo.mockImplementationOnce(async () => {
    host.status = 'refreshing'; 
  });
  const view = render(<InstanceIndicator />);
  fireEvent.click(await screen.findByRole('button', { name: 'DEV · main · Ready' }));
  fireEvent.click(screen.getByRole('button', { name: 'Full instance details' }));
  view.rerender(<InstanceIndicator />);
  expect(await screen.findByRole('dialog')).toBeVisible();
  expect(screen.getByRole('button', { name: 'DEV · main · Unavailable' })).toBeInTheDocument();
  expect(screen.getByText('instance')).toBeVisible();
  host.status = 'confirmed';
  view.rerender(<InstanceIndicator />);
  expect(await screen.findByRole('button', { name: 'DEV · main · Ready' })).toBeInTheDocument();
  expect(screen.getByRole('dialog')).toBeVisible();
});

it('keeps unavailable responses neutral', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
  render(<InstanceIndicator />);
  expect(await screen.findByRole('button', { name: 'DEV · main · Unavailable' })).toBeVisible();
  await waitFor(() => {
    expect(fetch).toHaveBeenCalledOnce(); 
  });
  expect(screen.queryByRole('button', { name: 'DEV · main · Ready' })).not.toBeInTheDocument();
});

it('clears old readiness when polling fails and cancels pending work on unmount', async () => {
  vi.useFakeTimers();
  const fetchStatus = vi.fn<(url: string, options: RequestInit) => Promise<unknown>>()
    .mockResolvedValueOnce({ ok: true, json: async () => payload })
    .mockRejectedValueOnce(new Error('unavailable'));
  vi.stubGlobal('fetch', fetchStatus);
  const view = render(<InstanceIndicator />);
  await act(async () => {
    await Promise.resolve(); 
  });
  expect(screen.getByRole('button', { name: 'DEV · main · Ready' })).toBeVisible();
  await act(async () => {
    await vi.advanceTimersToNextTimerAsync(); 
  });
  expect(screen.getByRole('button', { name: 'DEV · main · Unavailable' })).toBeVisible();
  view.unmount();
  await vi.advanceTimersByTimeAsync(10000);
  expect(fetchStatus).toHaveBeenCalledTimes(2);
  expect(fetchStatus.mock.calls[1][1].signal?.aborted).toBe(true);
});
