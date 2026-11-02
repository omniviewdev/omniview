import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProcessInventoryRows from './ProcessInventoryRows';

const backend = vi.hoisted(() => ({ snapshot: vi.fn() }));
vi.mock('@omniviewdev/runtime/api', () => ({ ProcessInventory: { GetSnapshot: backend.snapshot } }));
vi.mock('@/features/windows/identity', () => ({ currentWindow: { name: 'main' } }));

const identity = { pid: 1234, startIdentity: 'darwin:1793569709:323824', executable: '/Applications/Omniview.app/Contents/MacOS/Omniview' };
const host = { key: 'host', role: 'host', pluginID: '', ownership: 'verified', identity, evidence: 'self', error: '', windowAssociation: 'verified', windows: [{ name: 'settings', id: 2, nativeID: 107631, ownership: 'verified', error: '' }] };
function snapshot(processes: unknown[] = [host]) {
  return { observedAt: '2026-11-01T00:00:00Z', processes }; 
}

function mount(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const view = render(<QueryClientProvider client={client}><ProcessInventoryRows /></QueryClientProvider>);
  return { ...view, client };
}

function visibility(value: string) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
  fireEvent(document, new Event('visibilitychange'));
}

beforeEach(() => {
  backend.snapshot.mockReset().mockResolvedValue(snapshot()); 
});
afterEach(() => {
  cleanup();
  visibility('visible');
  vi.useRealTimers();
});

describe('process inventory', () => {
  it('shows full identity and host window IDs only in expandable details', async () => {
    mount();
    expect(await screen.findByText('PID 1234 · verified')).toBeVisible();
    const details = screen.getByText('Host').closest('details')!;
    expect(details).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('Host'));
    expect(screen.getByText(identity.startIdentity)).toBeVisible();
    expect(screen.getByText(identity.executable)).toBeVisible();
    expect(screen.getByText('settings · Wails ID 2 · Native ID 107631')).toBeVisible();
  });

  it('suppresses unknown, errored, malformed, worker, and unsupported shared identities', async () => {
    const variants = [
      { ownership: 'unknown' }, { error: 'gone' },
      { identity: { ...identity, startIdentity: '' } },
      { identity: { ...identity, executable: '' } },
      { identity: { ...identity, pid: -1 } },
      { role: 'webcontent' }, { role: 'gpu', ownership: 'shared' },
      { role: 'plugin', ownership: 'shared', evidence: 'backend' },
      { error: undefined }, { error: false }, { identity: null },
      { role: 'plugin', ownership: 'shared', evidence: 'in-process', identity: { ...identity, pid: 9999 } },
    ];
    backend.snapshot.mockResolvedValue(snapshot(variants.map((variant, index) => ({ ...host, key: `bad:${index}`, ...variant }))));
    mount();
    expect(await screen.findAllByText('unverified')).toHaveLength(variants.length);
    expect(screen.queryByText(/PID /)).not.toBeInTheDocument();
    expect(screen.queryByText(identity.startIdentity)).not.toBeInTheDocument();
  });

  it('shows shared PID only when it matches a verified host identity', async () => {
    backend.snapshot.mockResolvedValue(snapshot([host, { ...host, key: 'plugin:local', role: 'plugin', pluginID: 'local', ownership: 'shared', evidence: 'in-process' }]));
    mount();
    expect(await screen.findByText('PID 1234 · shared')).toBeVisible();
  });

  it('hides cached PID after refresh failure and restores fresh identity after recovery', async () => {
    const { client } = mount();
    expect(await screen.findByText('PID 1234 · verified')).toBeVisible();
    backend.snapshot.mockRejectedValue(new Error('disconnected'));
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['process-inventory'] }); 
    });
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(screen.queryByText(/PID /)).not.toBeInTheDocument();
    backend.snapshot.mockResolvedValue(snapshot([{ ...host, identity: { ...identity, pid: 5678 } }]));
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['process-inventory'] }); 
    });
    expect(await screen.findByText('PID 5678 · verified')).toBeVisible();
    expect(screen.queryByText(/PID 1234/)).not.toBeInTheDocument();
  });

  it('does not flash an old PID on immediate remount with a pending fresh observation', async () => {
    const first = mount();
    expect(await screen.findByText('PID 1234 · verified')).toBeVisible();
    first.unmount();
    const next = snapshot([{ ...host, identity: { ...identity, pid: 5678 } }]);
    const pending = Promise.withResolvers<typeof next>();
    backend.snapshot.mockReturnValue(pending.promise);
    mount(first.client);
    expect(screen.queryByText(/PID /)).not.toBeInTheDocument();
    await act(async () => {
      pending.resolve(next); 
    });
    expect(await screen.findByText('PID 5678 · verified')).toBeVisible();
  });

  it('does not reuse a visible lifetime while a restored window awaits a new snapshot', async () => {
    mount();
    expect(await screen.findByText('PID 1234 · verified')).toBeVisible();
    visibility('hidden');
    const next = snapshot([{ ...host, identity: { ...identity, pid: 5678, startIdentity: 'darwin:1793570006:525417' } }]);
    const pending = Promise.withResolvers<typeof next>();
    backend.snapshot.mockReturnValue(pending.promise);
    visibility('visible');
    expect(screen.queryByText(/PID /)).not.toBeInTheDocument();
    await act(async () => {
      pending.resolve(next);
    });
    expect(await screen.findByText('PID 5678 · verified')).toBeVisible();
    expect(screen.queryByText(/PID 1234/)).not.toBeInTheDocument();
  });

  it('keeps verified native window IDs when another window cannot be verified', async () => {
    backend.snapshot.mockResolvedValue(snapshot([{
      ...host,
      windowAssociation: 'unverified',
      windows: [...host.windows, { name: 'pending', id: 3, nativeID: 0, ownership: 'unverified', error: 'Not yet native' }],
    }]));
    mount();
    expect(await screen.findByText('PID 1234 · verified')).toBeVisible();
    fireEvent.click(screen.getByText('Host'));
    expect(screen.getByText('settings · Wails ID 2 · Native ID 107631')).toBeVisible();
    expect(screen.getByText('pending · Wails ID 3 · Native ID unverified')).toBeVisible();
  });

  it('fetches only while mounted and visible, with five-second polling', async () => {
    vi.useFakeTimers();
    visibility('hidden');
    const view = mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000); 
    });
    expect(backend.snapshot).not.toHaveBeenCalled();
    visibility('visible');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1); 
    });
    expect(backend.snapshot).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000); 
    });
    expect(backend.snapshot).toHaveBeenCalledTimes(2);
    visibility('hidden');
    const count = backend.snapshot.mock.calls.length;
    expect(screen.queryByText(/PID /)).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000); 
    });
    expect(backend.snapshot).toHaveBeenCalledTimes(count);
    visibility('visible');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5001); 
    });
    expect(backend.snapshot).toHaveBeenCalledTimes(count + 2);
    view.unmount();
    const closedCount = backend.snapshot.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000); 
    });
    expect(backend.snapshot).toHaveBeenCalledTimes(closedCount);
  });
});
