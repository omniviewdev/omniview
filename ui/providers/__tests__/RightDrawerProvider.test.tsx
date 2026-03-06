import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RightDrawerContext } from '@omniviewdev/runtime';

import RightDrawerProvider from '../RightDrawerProvider';

const mocks = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockUpdate: vi.fn(),
  mockShowSnackbar: vi.fn(),
  mockShowAppError: vi.fn(),
  mockBottomDrawerOn: vi.fn(() => vi.fn()),
  mockGetDrawerFactory: vi.fn(() => undefined),
  mockGetSidebarComponent: vi.fn(() => undefined),
}));

vi.mock('@omniviewdev/runtime', async () => {
  const actual = await vi.importActual<typeof import('@omniviewdev/runtime')>('@omniviewdev/runtime');
  return {
    ...actual,
    useSnackbar: () => ({ showSnackbar: mocks.mockShowSnackbar }),
    showAppError: (...args: unknown[]) => mocks.mockShowAppError(...args),
  };
});

vi.mock('@omniviewdev/runtime/api', () => ({
  ResourceClient: {
    Get: (...args: unknown[]) => mocks.mockGet(...args),
    Update: (...args: unknown[]) => mocks.mockUpdate(...args),
  },
}));

vi.mock('@/providers/BottomDrawer/events', () => ({
  bottomDrawerChannel: {
    on: (...args: unknown[]) => mocks.mockBottomDrawerOn(...args),
  },
}));

vi.mock('@/features/plugins/PluginManager', () => ({
  getDrawerFactory: (...args: unknown[]) => mocks.mockGetDrawerFactory(...args),
  getSidebarComponent: (...args: unknown[]) => mocks.mockGetSidebarComponent(...args),
}));

vi.mock('@/components/displays/RightDrawer', () => ({
  __esModule: true,
  default: () => <div data-testid="right-drawer" />,
}));

function Trigger() {
  const drawer = React.useContext(RightDrawerContext);
  if (!drawer) {
    throw new Error('RightDrawerContext unavailable in test harness');
  }

  return (
    <button
      onClick={() => drawer.showResourceSidebar({
        pluginID: 'kubernetes',
        connectionID: 'conn-1',
        resourceKey: 'core::v1::Pod',
        resourceID: 'pod-1',
        namespace: 'kube-system',
      })}
      type="button"
    >
      open
    </button>
  );
}

describe('RightDrawerProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockGet.mockResolvedValue({ result: { metadata: { name: 'pod-1' } } });
  });

  it('showResourceSidebar builds resource.GetInput and opens the drawer', async () => {
    render(
      <RightDrawerProvider>
        <Trigger />
      </RightDrawerProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'open' }));

    await waitFor(() => {
      expect(mocks.mockGet).toHaveBeenCalledTimes(1);
    });

    const input = mocks.mockGet.mock.calls[0][3] as { id: string; namespace: string };
    expect(input.id).toBe('pod-1');
    expect(input.namespace).toBe('kube-system');

    await waitFor(() => {
      expect(screen.getByTestId('right-drawer')).toBeInTheDocument();
    });

    expect(mocks.mockShowAppError).not.toHaveBeenCalled();
  });
});
