import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ClusterEditPage from './ClusterEditPage';

// ---------------------------------------------------------------------------
// Module-level mock state (reset in beforeEach)
// ---------------------------------------------------------------------------

const mockNavigate = jest.fn();
let mockConnectionData: any = null;
let mockConnectionOverrides: Record<string, any> = {};
let mockAvailableTags: string[] = [];
const mockUpdateOverride = jest.fn().mockResolvedValue(undefined);

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ id: 'test-cluster' }),
    useNavigate: () => mockNavigate,
  };
});

jest.mock('@omniviewdev/runtime', () => ({
  usePluginContext: () => ({ meta: { id: 'kubernetes' } }),
  useConnection: () => ({ connection: { data: mockConnectionData } }),
}));

jest.mock('../hooks/useClusterPreferences', () => ({
  useClusterPreferences: () => ({
    connectionOverrides: mockConnectionOverrides,
    availableTags: mockAvailableTags,
    updateOverride: mockUpdateOverride,
  }),
}));

// Stub child components as lightweight divs with interactive buttons
jest.mock('../components/connections/AvatarEditor', () => ({
  __esModule: true,
  default: ({ name, onAvatarUrlChange, onAvatarColorChange }: any) => (
    <div data-testid="avatar-editor" data-name={name}>
      <button data-testid="avatar-change-url" onClick={() => onAvatarUrlChange('http://new-avatar.png')}>
        Change Avatar URL
      </button>
      <button data-testid="avatar-change-color" onClick={() => onAvatarColorChange('#ff0000')}>
        Change Avatar Color
      </button>
    </div>
  ),
}));

jest.mock('../components/connections/TagInput', () => ({
  __esModule: true,
  default: ({ tags, availableTags, onChange }: any) => (
    <div data-testid="tag-input" data-tags={JSON.stringify(tags)} data-available={JSON.stringify(availableTags)}>
      <button data-testid="tag-add" onClick={() => onChange([...tags, 'new-tag'])}>
        Add Tag
      </button>
    </div>
  ),
}));

jest.mock('../components/settings/MetricsTabContent', () => ({
  __esModule: true,
  default: ({ pluginID, connectionID, connected }: any) => (
    <div data-testid="metrics-content" data-plugin-id={pluginID} data-connection-id={connectionID} data-connected={String(connected)} />
  ),
}));

jest.mock('../components/settings/NodeShellTabContent', () => ({
  __esModule: true,
  default: ({ pluginID, connectionID }: any) => (
    <div data-testid="node-shell-content" data-plugin-id={pluginID} data-connection-id={connectionID} />
  ),
}));

// Stub the layout components as pass-through containers
jest.mock('../layouts/resource', () => ({
  __esModule: true,
  default: {
    Root: ({ children }: any) => <div data-testid="layout-root">{children}</div>,
    SideNav: ({ children }: any) => <div data-testid="layout-sidenav">{children}</div>,
    Main: ({ children }: any) => <div data-testid="layout-main">{children}</div>,
  },
}));

jest.mock('@omniviewdev/ui/overlays', () => ({
  Tooltip: ({ title, children }: any) => <span data-tooltip={title}>{children}</span>,
}));

jest.mock('../utils/color', () => ({
  stringToColor: (s: string) => `#mock-color-${s}`,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPage(section?: string) {
  const entry = section ? `/?section=${section}` : '/';
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ClusterEditPage />
    </MemoryRouter>,
  );
}

function makeConnection(overrides: Record<string, any> = {}) {
  return {
    id: 'test-cluster',
    name: 'my-cluster',
    last_refresh: new Date(Date.now() - 30_000).toISOString(), // 30s ago
    expiry_time: 300_000, // 5 minutes
    labels: {
      cluster: 'my-cluster',
      kubeconfig: '/home/user/.kube/config',
      user: 'admin',
      server: 'https://10.0.0.1:6443',
      auth_method: 'token',
    },
    data: {
      server_url: 'https://10.0.0.1:6443',
      k8s_version: 'v1.28.3',
      k8s_platform: 'linux/amd64',
      node_count: 3,
      api_groups: 42,
      last_checked: new Date(Date.now() - 60_000).toISOString(),
      cluster: 'my-cluster',
      kubeconfig: '/home/user/.kube/config',
      user: 'admin',
      namespace: 'default',
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mockConnectionData = makeConnection();
  mockConnectionOverrides = {};
  mockAvailableTags = [];
});

// ---- 1. Sidebar cluster card ----

describe('Sidebar header', () => {
  it('renders "Cluster Settings" title', () => {
    renderPage();
    expect(screen.getByText('Cluster Settings')).toBeInTheDocument();
  });
});

describe('Sidebar cluster card', () => {
  it('renders cluster name from conn.name', () => {
    renderPage();
    expect(screen.getByText('my-cluster')).toBeInTheDocument();
  });

  it('shows Connected chip when within expiry window', () => {
    renderPage();
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('shows Disconnected chip when expired', () => {
    mockConnectionData = makeConnection({
      last_refresh: new Date(Date.now() - 600_000).toISOString(), // 10min ago
      expiry_time: 60_000, // 1 min
    });
    renderPage();
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
  });

  it('shows Disconnected when last_refresh is invalid', () => {
    mockConnectionData = makeConnection({ last_refresh: 'not-a-date' });
    renderPage();
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
  });

  it('uses displayName from overrides when set', () => {
    mockConnectionOverrides = {
      'test-cluster': { displayName: 'Production East' },
    };
    renderPage();
    expect(screen.getByText('Production East')).toBeInTheDocument();
  });
});

// ---- 2. Deep linking via search params ----

describe('Deep linking via search params', () => {
  it('defaults to identity section when no ?section= param', () => {
    renderPage();
    expect(screen.getByTestId('avatar-editor')).toBeInTheDocument();
  });

  it('renders identity section for ?section=identity', () => {
    renderPage('identity');
    expect(screen.getByTestId('avatar-editor')).toBeInTheDocument();
  });

  it('renders tags section for ?section=tags', () => {
    renderPage('tags');
    expect(screen.getByTestId('tag-input')).toBeInTheDocument();
  });

  it('renders cluster-info section for ?section=cluster-info', () => {
    renderPage('cluster-info');
    expect(screen.getByText('Read-only information discovered from the cluster.')).toBeInTheDocument();
    expect(screen.getByText('v1.28.3')).toBeInTheDocument();
  });

  it('renders connection section for ?section=connection', () => {
    renderPage('connection');
    expect(screen.getByText('Kubeconfig context details for this cluster.')).toBeInTheDocument();
    expect(screen.getByText('test-cluster')).toBeInTheDocument();
  });

  it('renders metrics section with correct props for ?section=metrics', () => {
    renderPage('metrics');
    const el = screen.getByTestId('metrics-content');
    expect(el).toHaveAttribute('data-plugin-id', 'kubernetes');
    expect(el).toHaveAttribute('data-connection-id', 'test-cluster');
  });

  it('renders node-shell section with correct props for ?section=node-shell', () => {
    renderPage('node-shell');
    const el = screen.getByTestId('node-shell-content');
    expect(el).toHaveAttribute('data-plugin-id', 'kubernetes');
    expect(el).toHaveAttribute('data-connection-id', 'test-cluster');
  });
});

// ---- 3. Sidebar navigation ----

describe('Sidebar navigation', () => {
  it('clicking Tags nav item switches to tags section', () => {
    renderPage('identity');
    fireEvent.click(screen.getByText('Tags'));
    expect(screen.getByTestId('tag-input')).toBeInTheDocument();
  });

  it('clicking through multiple sections works', () => {
    renderPage('identity');

    fireEvent.click(screen.getByText('Tags'));
    expect(screen.getByTestId('tag-input')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Connection'));
    expect(screen.getByText('Kubeconfig context details for this cluster.')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Identity'));
    expect(screen.getByTestId('avatar-editor')).toBeInTheDocument();
  });
});

// ---- 4. Esc key handler ----

describe('Esc key handler', () => {
  it('pressing Escape calls navigate(-1)', () => {
    renderPage();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });

  it('other keys do not trigger navigation', () => {
    renderPage();
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'a' });
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

// ---- 5. Back button ----

describe('Back button', () => {
  it('clicking back arrow calls navigate(-1)', () => {
    const { container } = renderPage();
    // The back button is the first IconButton containing the LuArrowLeft icon
    const backButton = container.querySelector('[data-testid="layout-sidenav"] button');
    expect(backButton).toBeTruthy();
    fireEvent.click(backButton!);
    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });
});

// ---- 6. Save / Cancel / Dirty state ----

describe('Save / Cancel / Dirty state', () => {
  const getSaveBtn = (container: HTMLElement) => container.querySelector('[data-tooltip="Save changes"] button');
  const getCancelBtn = (container: HTMLElement) => container.querySelector('[data-tooltip="Discard changes"] button');

  it('Save and Cancel buttons hidden when no unsaved changes', () => {
    const { container } = renderPage();
    expect(getSaveBtn(container)).toBeNull();
    expect(getCancelBtn(container)).toBeNull();
  });

  it('making a change via AvatarEditor shows Save and Cancel', () => {
    const { container } = renderPage('identity');
    fireEvent.click(screen.getByTestId('avatar-change-url'));
    expect(getSaveBtn(container)).toBeTruthy();
    expect(getCancelBtn(container)).toBeTruthy();
  });

  it('Save calls updateOverride with correct data and navigates back', async () => {
    const { container } = renderPage('identity');
    fireEvent.click(screen.getByTestId('avatar-change-url'));

    await act(async () => {
      fireEvent.click(getSaveBtn(container)!);
    });

    expect(mockUpdateOverride).toHaveBeenCalledWith(
      'test-cluster',
      expect.objectContaining({ avatar: 'http://new-avatar.png' }),
    );
    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });

  it('Cancel resets form state and hides Save/Cancel', () => {
    const { container } = renderPage('identity');
    fireEvent.click(screen.getByTestId('avatar-change-url'));
    expect(getSaveBtn(container)).toBeTruthy();

    fireEvent.click(getCancelBtn(container)!);
    expect(getSaveBtn(container)).toBeNull();
    expect(getCancelBtn(container)).toBeNull();
  });
});

// ---- 7. Identity section content ----

describe('Identity section', () => {
  it('renders AvatarEditor, Display Name, and Description labels', () => {
    renderPage('identity');
    expect(screen.getByTestId('avatar-editor')).toBeInTheDocument();
    expect(screen.getByText('Display Name')).toBeInTheDocument();
    expect(screen.getByText('Description')).toBeInTheDocument();
  });

  it('AvatarEditor receives correct name prop (conn.name when no override)', () => {
    renderPage('identity');
    expect(screen.getByTestId('avatar-editor')).toHaveAttribute('data-name', 'my-cluster');
  });

  it('AvatarEditor uses displayName override when available', () => {
    mockConnectionOverrides = {
      'test-cluster': { displayName: 'Custom Name' },
    };
    renderPage('identity');
    expect(screen.getByTestId('avatar-editor')).toHaveAttribute('data-name', 'Custom Name');
  });

  it('AvatarEditor falls back to connectionId when conn.name is undefined', () => {
    mockConnectionData = makeConnection({ name: undefined });
    renderPage('identity');
    expect(screen.getByTestId('avatar-editor')).toHaveAttribute('data-name', 'test-cluster');
  });
});

// ---- 8. Tags section ----

describe('Tags section', () => {
  it('renders TagInput with empty tags by default', () => {
    renderPage('tags');
    const el = screen.getByTestId('tag-input');
    expect(el).toHaveAttribute('data-tags', '[]');
  });

  it('renders tags from overrides', () => {
    mockConnectionOverrides = {
      'test-cluster': { tags: ['prod', 'east'] },
    };
    renderPage('tags');
    const el = screen.getByTestId('tag-input');
    expect(el).toHaveAttribute('data-tags', '["prod","east"]');
  });

  it('adding a tag marks form as dirty', () => {
    const { container } = renderPage('tags');
    expect(container.querySelector('[data-tooltip="Save changes"]')).toBeNull();
    fireEvent.click(screen.getByTestId('tag-add'));
    expect(container.querySelector('[data-tooltip="Save changes"]')).toBeTruthy();
  });
});

// ---- 9. Cluster Info section ----

describe('Cluster Info section', () => {
  it('displays all label/value rows', () => {
    renderPage('cluster-info');
    expect(screen.getByText('Server')).toBeInTheDocument();
    expect(screen.getByText('https://10.0.0.1:6443')).toBeInTheDocument();
    expect(screen.getByText('Kubernetes Version')).toBeInTheDocument();
    expect(screen.getByText('v1.28.3')).toBeInTheDocument();
    expect(screen.getByText('Platform')).toBeInTheDocument();
    expect(screen.getByText('linux/amd64')).toBeInTheDocument();
    expect(screen.getByText('Nodes')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('API Groups')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Last Checked')).toBeInTheDocument();
  });

  it('shows "Not discovered" for missing values', () => {
    mockConnectionData = makeConnection({
      data: {},
      labels: {},
    });
    renderPage('cluster-info');
    const notDiscovered = screen.getAllByText('Not discovered');
    expect(notDiscovered.length).toBeGreaterThanOrEqual(1);
  });
});

// ---- 10. Connection section ----

describe('Connection section', () => {
  it('displays all label/value rows', () => {
    renderPage('connection');
    expect(screen.getByText('Context')).toBeInTheDocument();
    expect(screen.getByText('Cluster')).toBeInTheDocument();
    expect(screen.getByText('Kubeconfig')).toBeInTheDocument();
    expect(screen.getByText('User')).toBeInTheDocument();
    expect(screen.getByText('Auth Method')).toBeInTheDocument();
    expect(screen.getByText('Namespace')).toBeInTheDocument();
    expect(screen.getByText('Last Refresh')).toBeInTheDocument();
  });

  it('shows correct kubeconfig value', () => {
    renderPage('connection');
    expect(screen.getByText('/home/user/.kube/config')).toBeInTheDocument();
  });
});

// ---- 11. Edge cases ----

describe('Edge cases', () => {
  it('conn is null — cluster-info section does not render content', () => {
    mockConnectionData = null;
    renderPage('cluster-info');
    // ClusterInfoSection is guarded by `conn &&`, so the section header won't render
    expect(screen.queryByText('Read-only information discovered from the cluster.')).not.toBeInTheDocument();
  });

  it('conn is null — connection section does not render content', () => {
    mockConnectionData = null;
    renderPage('connection');
    expect(screen.queryByText('Kubeconfig context details for this cluster.')).not.toBeInTheDocument();
  });

  it('conn.name undefined falls back to connectionId in the card', () => {
    mockConnectionData = makeConnection({ name: undefined });
    renderPage();
    // The card should show connectionId as fallback
    expect(screen.getByText('test-cluster')).toBeInTheDocument();
  });

  it('invalid date in last_refresh shows Disconnected', () => {
    mockConnectionData = makeConnection({ last_refresh: 'garbage' });
    renderPage();
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
  });
});
