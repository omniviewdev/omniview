import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ConnectionProfiles from './ConnectionProfiles';
import { connectionProfilePath, connectionProfilesPath, resourceBrowserPath } from '@/features/workspace/pagePaths';

const mocks = vi.hoisted(() => ({ profiles: vi.fn(), reload: vi.fn(), refetch: vi.fn() }));
vi.mock('@omniviewdev/runtime', () => ({
  parseAppError: (error: unknown) => ({ detail: String(error) }),
  useConnectionProfiles: (options: unknown) => {
    mocks.profiles(options);
    return { profiles: { data: [{ id: 'prod%2Fblue', source: 'native', active: true }], refetch: mocks.refetch } };
  },
}));
vi.mock('@/features/command-search/commands', () => ({ reloadConnections: mocks.reload }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reload.mockResolvedValue(undefined);
  mocks.refetch.mockResolvedValue(undefined);
});

it.each(['provider/opaque', 'provider%2Fopaque', 'provider%252Fopaque'])('loads and reloads exact opaque provider %s', async (pluginID) => {
  const queryClient = new QueryClient();
  render(<QueryClientProvider client={queryClient}>
    <MemoryRouter initialEntries={[connectionProfilesPath(pluginID)]}>
      <Routes><Route path="connections/:pluginID" element={<ConnectionProfiles />} /></Routes>
    </MemoryRouter>
  </QueryClientProvider>);
  expect(mocks.profiles).toHaveBeenCalledWith({ pluginID });
  expect(screen.getByRole('link', { name: 'Review / edit profile' })).toHaveAttribute('href', connectionProfilePath(pluginID, 'prod%2Fblue'));
  expect(screen.getByRole('link', { name: 'Browse resources' })).toHaveAttribute('href', resourceBrowserPath(pluginID, 'prod%2Fblue'));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Reload source inventory' })));
  expect(mocks.reload).toHaveBeenCalledWith(queryClient, pluginID);
  expect(mocks.refetch).toHaveBeenCalledWith({ throwOnError: true });
});
