import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivePageNavigationContext } from '@/features/workspace/activePageNavigation';
import HostProfilingIndicator from './HostProfilingIndicator';

const backend = vi.hoisted(() => ({ getStatus: vi.fn(), getPluginStatuses: vi.fn() }));
vi.mock('@omniviewdev/runtime/api', () => ({
  HostProfiling: { GetStatus: backend.getStatus },
  PluginManager: { GetPluginProfilingStatuses: backend.getPluginStatuses },
}));

beforeEach(() => {
  backend.getPluginStatuses.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  vi.useRealTimers();
});

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const navigate = vi.fn();
  render(<QueryClientProvider client={client}>
    <ActivePageNavigationContext.Provider value={{ pathname: '/', search: '', navigate,
      openInNewTab: vi.fn(), openInNewWindow: vi.fn() }}>
      <HostProfilingIndicator />
    </ActivePageNavigationContext.Provider>
  </QueryClientProvider>);
  return { client, navigate };
}

describe('host profiling footer', () => {
  it('shows actual listener, then reports failure without a stale endpoint', async () => {
    backend.getStatus.mockResolvedValue({ running: true, url: 'http://127.0.0.1:43210/debug/pprof/', source: 'settings', error: '' });
    const { client, navigate } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Host profiling: Running' }));
    expect(await screen.findByText('http://127.0.0.1:43210/debug/pprof/')).toBeVisible();
    backend.getStatus.mockResolvedValue({ running: false, url: '', source: 'environment', error: 'Port unavailable' });
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['host-profiling', 'status'] });
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Port unavailable');
    expect(screen.getByRole('button', { name: 'Host profiling: Error' })).toBeVisible();
    expect(screen.queryByText('http://127.0.0.1:43210/debug/pprof/')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Developer Settings' }));
    expect(navigate).toHaveBeenCalledWith('/settings?section=core&category=developer');
  });

  it('hides a cached endpoint when refreshing status fails and restores it after recovery', async () => {
    const url = 'http://127.0.0.1:43210/debug/pprof/';
    backend.getStatus.mockReset().mockResolvedValue({ running: true, url, source: 'settings', error: '' });
    const { client } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Host profiling: Running' }));
    expect(await screen.findByText(url)).toBeVisible();

    backend.getStatus.mockRejectedValue(new Error('Backend unavailable'));
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['host-profiling', 'status'] });
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load host profiling status.');
    expect(screen.getByRole('button', { name: 'Host profiling: Error' })).toBeVisible();
    expect(screen.queryByText(url)).not.toBeInTheDocument();

    backend.getStatus.mockResolvedValue({ running: true, url, source: 'settings', error: '' });
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['host-profiling', 'status'] });
    });
    expect(await screen.findByText(url)).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('supports keyboard opening, dismissal, and safety help', async () => {
    backend.getStatus.mockReset().mockResolvedValue({ running: false, url: '', source: 'settings', error: '' });
    const user = userEvent.setup();
    mount();
    const trigger = await screen.findByRole('button', { name: 'Host profiling: Off' });
    act(() => {
      trigger.focus();
    });
    await user.keyboard('{Enter}');
    const settings = await screen.findByRole('button', { name: 'Developer Settings' });
    expect(settings).toBeVisible();
    act(() => {
      settings.focus();
    });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: 'Developer Settings' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.keyboard('{Enter}');
    const safety = await screen.findByRole('button', { name: 'Profiling safety' });
    act(() => {
      screen.getByRole('button', { name: 'Developer Settings' }).focus();
    });
    await user.tab({ shift: true });
    expect(safety).toHaveFocus();
    expect(await screen.findByText('Unauthenticated, local-only access. Profiles may contain sensitive data; do not forward this port. CPU captures cannot run alongside Pyroscope.')).toBeVisible();
  });

  it('does not fetch until an initially hidden window becomes visible', async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    backend.getStatus.mockReset().mockResolvedValue({ running: false, url: '', source: 'settings', error: '' });
    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(backend.getStatus).not.toHaveBeenCalled();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    fireEvent(document, new Event('visibilitychange'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(backend.getStatus).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Host profiling: Off' })).toBeVisible();
  });

  it('stops listener polling while hidden and resumes when visible', async () => {
    vi.useFakeTimers();
    backend.getStatus.mockReset().mockResolvedValue({ running: false, url: '', source: 'settings', error: '' });
    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByRole('button', { name: 'Host profiling: Off' })).toBeVisible();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    fireEvent(document, new Event('visibilitychange'));
    const calls = backend.getStatus.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(backend.getStatus).toHaveBeenCalledTimes(calls);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    fireEvent(document, new Event('visibilitychange'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5001);
    });
    expect(backend.getStatus.mock.calls.length).toBeGreaterThan(calls);
  });

  it('does not reuse a closed popover plugin endpoint while the new process status is pending', async () => {
    backend.getStatus.mockReset().mockResolvedValue({ running: false, url: '', source: 'settings', error: '' });
    const endpointA = 'http://127.0.0.1:43211/debug/pprof/';
    const endpointB = 'http://127.0.0.1:43212/debug/pprof/';
    backend.getPluginStatuses.mockResolvedValue([
      { pluginID: 'kubernetes', supported: true, running: true, url: endpointA, error: '', pid: 1234 },
    ]);
    const user = userEvent.setup();
    mount();
    const trigger = await screen.findByRole('button', { name: 'Host profiling: Off' });
    expect(backend.getPluginStatuses).not.toHaveBeenCalled();
    act(() => {
      trigger.focus();
    });
    await user.keyboard('{Enter}');
    expect(await screen.findByText(endpointA)).toBeVisible();
    expect(screen.getByText('PID 1234')).toBeVisible();
    act(() => {
      screen.getByRole('button', { name: 'Developer Settings' }).focus();
    });
    await user.keyboard('{Escape}');
    expect(screen.queryByText(endpointA)).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    const nextProcess = [
      { pluginID: 'kubernetes', supported: true, running: true, url: endpointB, error: '', pid: 5678 },
    ];
    const { promise, resolve: resolveStatus } = Promise.withResolvers<typeof nextProcess>();
    backend.getPluginStatuses.mockReturnValue(promise);
    expect(backend.getPluginStatuses).toHaveBeenCalledTimes(1);
    await user.keyboard('{Enter}');
    expect(backend.getPluginStatuses).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(endpointA)).not.toBeInTheDocument();
    expect(screen.queryByText('PID 1234')).not.toBeInTheDocument();
    expect(screen.queryByText(endpointB)).not.toBeInTheDocument();
    await act(async () => {
      resolveStatus(nextProcess);
    });
    expect(await screen.findByText(endpointB)).toBeVisible();
    expect(screen.getByText('PID 5678')).toBeVisible();
    expect(screen.queryByText(endpointA)).not.toBeInTheDocument();
    expect(screen.queryByText('PID 1234')).not.toBeInTheDocument();
  });

  it('shows plugin processes independently from host status and removes stale endpoints on failure', async () => {
    backend.getStatus.mockResolvedValue({ running: false, url: '', source: 'settings', error: '' });
    const url = 'http://127.0.0.1:43211/debug/pprof/';
    backend.getPluginStatuses.mockResolvedValue([
      { pluginID: 'kubernetes', supported: true, running: true, url, error: '', pid: 1234 },
      { pluginID: 'older', supported: false, running: false, url: '', error: '', pid: 0 },
    ]);
    const { client } = mount();
    const trigger = await screen.findByRole('button', { name: 'Host profiling: Off' });
    expect(backend.getPluginStatuses).not.toHaveBeenCalled();
    fireEvent.click(trigger);
    expect(await screen.findByText(url)).toBeVisible();
    expect(screen.getByText('PID 1234')).toBeVisible();
    expect(screen.getByText('SDK update required')).toBeVisible();
    backend.getPluginStatuses.mockRejectedValue(new Error('Host disconnected'));
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['plugin-profiling', 'status'] });
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Plugin status unavailable');
    expect(screen.queryByText(url)).not.toBeInTheDocument();
    backend.getPluginStatuses.mockResolvedValue([
      { pluginID: 'kubernetes', supported: true, running: false, url: '', error: '', pid: 5678 },
    ]);
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['plugin-profiling', 'status'] });
    });
    expect(await screen.findByText('PID 5678')).toBeVisible();
    expect(screen.queryByText('PID 1234')).not.toBeInTheDocument();
    expect(screen.queryByText(url)).not.toBeInTheDocument();
  });
});
