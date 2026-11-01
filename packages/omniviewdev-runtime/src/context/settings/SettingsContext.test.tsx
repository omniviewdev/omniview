import { act, cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), listeners: new Set<(event: unknown) => void>() }));
vi.mock('../../api', () => ({ SettingsService: { GetSnapshot: mocks.snapshot } }));
vi.mock('@wailsio/runtime', () => ({ Events: { On: (_: string, callback: (event: unknown) => void) => {
  mocks.listeners.add(callback);
  return () => mocks.listeners.delete(callback);
} } }));
import { useSettings } from '../../hooks/settings/useSettings';
import { SettingsProvider } from './SettingsContext';

function snapshot(theme: string) {
  return { scope: { kind: 'host' }, categories: { appearance: { settings: { theme: { value: theme } } } } };
}
function Probe() {
  const { settings } = useSettings();
  return <output>{JSON.stringify(settings)}</output>;
}

describe('shared host settings view', () => {
  beforeEach(() => { mocks.snapshot.mockReset(); });
  afterEach(cleanup);
  it('ignores stale hydration after a scoped change', async () => {
    const initial = Promise.withResolvers<unknown>();
    mocks.snapshot.mockReturnValueOnce(initial.promise).mockResolvedValue(snapshot('light'));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(<QueryClientProvider client={client}><SettingsProvider><Probe /></SettingsProvider></QueryClientProvider>);
    await act(async () => {
      for (const listener of mocks.listeners) listener({ data: { kind: 'host' } });
    });
    expect((await screen.findByText('{"appearance.theme":"light"}')).textContent).toBe('{"appearance.theme":"light"}');
    await act(async () => { initial.resolve(snapshot('dark')); await initial.promise; });
    expect(screen.getByRole('status').textContent).toBe('{"appearance.theme":"light"}');
  });
});
