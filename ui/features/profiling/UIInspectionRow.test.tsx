import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UIInspectionRow from './UIInspectionRow';

const backend = vi.hoisted(() => ({ getStatus: vi.fn(), window: { name: 'workspace-one' } }));
vi.mock('@omniviewdev/runtime/api', () => ({ UIInspection: { GetStatus: backend.getStatus } }));
vi.mock('@/features/windows/identity', () => ({ currentWindow: backend.window }));

const status = {
  supported: true, enabled: false, engine: 'WebKit', window: 'workspace-one',
  application: 'Actual App', target: 'localhost', error: '',
};

beforeEach(() => {
  backend.getStatus.mockReset();
  backend.window.name = 'workspace-one';
});
afterEach(() => {
  cleanup();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><UIInspectionRow /></QueryClientProvider>);
  return { client, ...view };
}

function setVisible(visible: boolean) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: visible ? 'visible' : 'hidden' });
  fireEvent(document, new Event('visibilitychange'));
}

describe('native UI inspection', () => {
  it.each([
    ['Off', { ...status, enabled: false }],
    ['Unavailable', { ...status, supported: false }],
    ['Error', { ...status, enabled: true, error: 'Native window unavailable' }],
  ])('shows %s without app or page targets', async (label, result) => {
    backend.getStatus.mockResolvedValue(result);
    mount();
    expect(await screen.findByText(label)).toBeVisible();
    expect(backend.getStatus).toHaveBeenCalledWith('workspace-one');
    expect(screen.queryByText('Actual App')).not.toBeInTheDocument();
    expect(screen.queryByText('localhost')).not.toBeInTheDocument();
    if (result.error) expect(screen.getByRole('alert')).toHaveTextContent(result.error);
  });

  it('removes enabled targets after a failed refresh', async () => {
    backend.getStatus.mockResolvedValue({ ...status, enabled: true });
    const { client } = mount();
    expect(await screen.findByText('Actual App')).toBeVisible();
    expect(screen.getByText('localhost')).toBeVisible();
    backend.getStatus.mockRejectedValue(new Error('Backend unavailable'));
    await act(async () => { await client.invalidateQueries({ queryKey: ['ui-inspection'] }); });
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(screen.queryByText('Actual App')).not.toBeInTheDocument();
    expect(screen.queryByText('localhost')).not.toBeInTheDocument();
  });

  it('makes no hidden calls and drops cached targets before another window becomes visible', async () => {
    setVisible(false);
    backend.getStatus.mockResolvedValue({ ...status, enabled: true });
    mount();
    expect(backend.getStatus).not.toHaveBeenCalled();
    setVisible(true);
    expect(await screen.findByText('Actual App')).toBeVisible();
    setVisible(false);
    expect(screen.queryByText('Actual App')).not.toBeInTheDocument();
    expect(backend.getStatus).toHaveBeenCalledTimes(1);
    backend.window.name = 'workspace-two';
    const { promise, resolve } = Promise.withResolvers<typeof status>();
    backend.getStatus.mockReturnValue(promise);
    setVisible(true);
    expect(screen.queryByText('Actual App')).not.toBeInTheDocument();
    expect(screen.queryByText('localhost')).not.toBeInTheDocument();
    expect(backend.getStatus).toHaveBeenLastCalledWith('workspace-two');
    await act(async () => { resolve({ ...status, window: 'workspace-two' }); });
    expect(await screen.findByText('Off')).toBeVisible();
  });

  it('requests fresh status without showing old targets on immediate reopen', async () => {
    backend.getStatus.mockResolvedValue({ ...status, enabled: true });
    const client = new QueryClient();
    const content = (open: boolean) => <QueryClientProvider client={client}>{open && <UIInspectionRow />}</QueryClientProvider>;
    const view = render(content(true));
    expect(await screen.findByText('Actual App')).toBeVisible();
    view.rerender(content(false));
    expect(screen.queryByText('Actual App')).not.toBeInTheDocument();
    backend.getStatus.mockResolvedValue(status);
    view.rerender(content(true));
    expect(screen.queryByText('Actual App')).not.toBeInTheDocument();
    expect(await screen.findByText('Off')).toBeVisible();
    expect(backend.getStatus).toHaveBeenCalledTimes(2);
  });
});
