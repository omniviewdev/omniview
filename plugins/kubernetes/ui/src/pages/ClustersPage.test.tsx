import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ClustersPage from './ClustersPage';

// ---------------------------------------------------------------------------
// Module-level mock state (reset in beforeEach)
// ---------------------------------------------------------------------------

let mockConnectionsData: any[] | undefined = undefined;
let mockIsLoading = false;

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@omniviewdev/runtime', () => ({
  usePluginContext: () => ({ meta: { id: 'kubernetes' } }),
  useConnections: () => ({
    connections: {
      data: mockConnectionsData,
      isLoading: mockIsLoading,
    },
    startInformer: vi.fn(),
    stopInformer: vi.fn(),
  }),
  useConnection: () => ({ deleteConnection: vi.fn().mockResolvedValue(undefined) }),
  useSnackbar: () => ({ showSnackbar: vi.fn() }),
}));

vi.mock('../components/shared/hooks/useStoredState', () => ({
  useStoredState: (_key: string, defaultValue: any) => {
    const state = vi.fn();
    return [defaultValue, state];
  },
}));

vi.mock('../hooks/useClusterPreferences', () => ({
  useClusterPreferences: () => ({
    favorites: new Set(),
    connectionOverrides: {},
    customGroups: [],
    recentConnections: [],
    hubSections: [],
    availableTags: [],
    toggleFavorite: vi.fn(),
    updateOverride: vi.fn(),
    addGroup: vi.fn(),
    removeGroup: vi.fn(),
    updateGroup: vi.fn(),
    assignToGroup: vi.fn(),
    removeFromGroup: vi.fn(),
    recordAccess: vi.fn(),
    setHubSections: vi.fn(),
    updateHubSectionCollapsed: vi.fn(),
  }),
}));

vi.mock('../hooks/useConnectionGrouping', () => ({
  useConnectionGrouping: (opts: any) => ({
    groups: [{
      key: 'all',
      label: 'All',
      connections: (opts.connections ?? []).map((c: any) => ({
        ...c,
        isFavorite: false,
        groupIds: [],
      })),
    }],
    totalCount: opts.connections?.length ?? 0,
    filteredCount: opts.connections?.length ?? 0,
    availableProviders: [],
    availableAttributes: {},
    availableTags: [],
  }),
}));

// Stub heavy child components
vi.mock('../components/connections/ClusterHub', () => ({
  default: () => <div data-testid="cluster-hub">ClusterHub</div>,
}));

vi.mock('../components/connections/ClustersToolbar', () => ({
  default: () => <div data-testid="clusters-toolbar">Toolbar</div>,
}));

vi.mock('../components/connections/FilterChips', () => ({
  default: () => <div data-testid="filter-chips">FilterChips</div>,
}));

vi.mock('../components/connections/ConnectionTable', () => ({
  default: () => <div data-testid="connection-table">ConnectionTable</div>,
}));

vi.mock('../components/connections/DeleteConfirmationModal', () => ({
  default: () => null,
}));

vi.mock('../components/connections/FolderDialog', () => ({
  default: () => null,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPage() {
  return render(<ClustersPage />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockConnectionsData = undefined;
  mockIsLoading = false;
});

describe('Loading state', () => {
  it('shows loading skeletons when isLoading=true and data is undefined', () => {
    mockIsLoading = true;
    mockConnectionsData = undefined;
    const { container } = renderPage();

    // Skeleton elements should be present (MUI Skeleton renders spans with class MuiSkeleton-root)
    const skeletons = container.querySelectorAll('.MuiSkeleton-root');
    expect(skeletons.length).toBeGreaterThanOrEqual(4);

    // Should NOT show "No Clusters Found"
    expect(screen.queryByText('No Clusters Found')).not.toBeInTheDocument();

    // Should NOT show ClusterHub
    expect(screen.queryByTestId('cluster-hub')).not.toBeInTheDocument();
  });

  it('does not show skeletons when isLoading=true but data exists', () => {
    mockIsLoading = true;
    mockConnectionsData = [{ id: 'c1', name: 'cluster-1' }];
    const { container } = renderPage();

    const skeletons = container.querySelectorAll('.MuiSkeleton-root');
    expect(skeletons.length).toBe(0);
    expect(screen.getByTestId('cluster-hub')).toBeInTheDocument();
  });
});

describe('Empty state', () => {
  it('shows "No Clusters Found" when not loading and data is empty', () => {
    mockIsLoading = false;
    mockConnectionsData = [];
    renderPage();

    expect(screen.getAllByText('No Clusters Found').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByTestId('cluster-hub')).not.toBeInTheDocument();
  });
});

describe('Data loaded state', () => {
  it('shows ClusterHub when connections exist', () => {
    mockIsLoading = false;
    mockConnectionsData = [
      { id: 'c1', name: 'cluster-1' },
      { id: 'c2', name: 'cluster-2' },
    ];
    renderPage();

    expect(screen.getByTestId('cluster-hub')).toBeInTheDocument();
    expect(screen.queryByText('No Clusters Found')).not.toBeInTheDocument();
  });
});
