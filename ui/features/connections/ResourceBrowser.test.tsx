import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type { ReactNode } from 'react';
import ResourceBrowser from './ResourceBrowser';
import { connectionProfilePath, connectionProfilesPath, resourceBrowserPath } from '@/features/workspace/pagePaths';

const state = vi.hoisted(() => ({
  connected: true, error: ((): unknown => null)(), type: 'native/resource::type/%2F',
  boundary: vi.fn(), connection: vi.fn(), types: vi.fn(), groups: vi.fn(),
  phase: 'ready', gateReady: true, gateEnabled: false,
}));
vi.mock('@omniviewdev/runtime', () => ({
  ConnectionBoundary: ({ children, ...options }: { children: ReactNode; pluginID: string; connectionID: string }): ReactNode => {
    state.boundary(options);
    return state.connected ? children : <div>Connection is disconnected</div>;
  },
  ConnectionBoundaryFallback: () => null,
  useConnection: (options: unknown) => {
    state.connection(options);
    return { connection: { data: { name: 'Production' } } };
  },
  useResourceTypes: (options: unknown) => {
    state.types(options);
    return { resourceTypes: { data: [{ type: state.type, displayName: 'Machines' }], isError: state.error !== null, error: state.error } };
  },
  useResourceGroups: (options: unknown) => {
    state.groups(options);
    return { groups: { data: [{ id: 'native', name: 'Native', icon: 'LuBoxes', resources: [state.type] }] } };
  },
  parseAppError: (error: unknown) => ({ detail: String(error) }),
}));
vi.mock('@/features/plugins', () => ({
  usePluginService: () => ({
    plugins: new Map([['provider', { phase: state.phase }], ['provider%2Fopaque', { phase: state.phase }]]),
    registrations: new Map(state.gateEnabled ? [['provider', { PreferenceMigrationGate: ({ children }: { children: ReactNode }) => <>{state.gateReady ? children : <div>Migration pending</div>}</> }]] : []),
  }),
}));
vi.mock('@/features/plugins/components/PluginRouteStatus', () => ({ default: () => <div>Plugin loading</div> }));
vi.mock('@/components/icons/Icon', () => ({ default: ({ name }: { name: string }) => <span data-testid="group-icon">{name}</span> }));
vi.mock('@/components/tables/Resources', () => ({ default: ({ pluginID, connectionID, resourceKey }: { pluginID: string; connectionID: string; resourceKey: string }) => <div data-testid="resource-table">{JSON.stringify([pluginID, connectionID, resourceKey])}</div> }));
function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function open(type?: string, pluginID = 'provider', connectionID = 'prod/west') {
  return render(<MemoryRouter initialEntries={[resourceBrowserPath(pluginID, connectionID, type)]}>
    <Routes><Route path="resources/:pluginID/:connectionID" element={<><ResourceBrowser /><Location /></>} /></Routes>
  </MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks(); state.connected = true; state.error = null; state.phase = 'ready'; state.gateReady = true; state.gateEnabled = false;
});

it('keeps opaque type selection in the active workspace URL and preserves group icons', () => {
  open();
  expect(screen.getByTestId('group-icon').textContent).toBe('LuBoxes');
  fireEvent.click(screen.getByRole('button', { name: 'Machines' }));
  expect(screen.getByTestId('resource-table').textContent).toBe(JSON.stringify(['provider', 'prod/west', state.type]));
  expect(screen.getByTestId('location').textContent).toBe(resourceBrowserPath('provider', 'prod/west', state.type));
});

it('renders canonical resource tables from direct workspace links', () => {
  open(state.type);
  expect(screen.getByTestId('resource-table').textContent).toContain(state.type);
  expect(screen.getByRole('link', { name: 'Edit connection profile' })).toHaveAttribute('href', '/connections/provider/prod%2Fwest/edit');
});

it('shows discovery errors instead of an empty catalogue', () => {
  state.error = new Error('Catalogue unavailable');
  open();
  expect(screen.getByText('Error: Catalogue unavailable')).toBeTruthy();
  expect(screen.queryByText('No resource types are advertised.')).toBeNull();
});

it('waits for plugin registration and provider preference migration before mounting tables', () => {
  state.phase = 'loading';
  state.gateEnabled = true;
  state.gateReady = false;
  const view = open(state.type);
  expect(screen.getByText('Plugin loading')).toBeTruthy();
  expect(screen.queryByTestId('resource-table')).toBeNull();
  state.phase = 'ready';
  view.rerender(<MemoryRouter initialEntries={[resourceBrowserPath('provider', 'prod/west', state.type)]}>
    <Routes><Route path="resources/:pluginID/:connectionID" element={<ResourceBrowser />} /></Routes>
  </MemoryRouter>);
  expect(screen.getByText('Migration pending')).toBeTruthy();
  expect(screen.queryByTestId('resource-table')).toBeNull();
  state.gateReady = true;
  view.rerender(<MemoryRouter initialEntries={[resourceBrowserPath('provider', 'prod/west', state.type)]}>
    <Routes><Route path="resources/:pluginID/:connectionID" element={<ResourceBrowser />} /></Routes>
  </MemoryRouter>);
  expect(screen.getByTestId('resource-table')).toBeTruthy();
});

it('does not mount resource readers before readiness allows access', () => {
  state.connected = false;
  open(state.type);
  expect(screen.getByText('Connection is disconnected')).toBeTruthy();
  expect(screen.queryByTestId('resource-table')).toBeNull();
});

it.each(['prod/blue', 'prod%2Fblue', 'prod%252Fblue'])('preserves opaque host identities for %s', (connectionID) => {
  const pluginID = 'provider%2Fopaque';
  open(state.type, pluginID, connectionID);
  expect(state.boundary).toHaveBeenCalledWith(expect.objectContaining({ pluginID, connectionID }));
  expect(state.connection).toHaveBeenCalledWith({ pluginID, connectionID });
  expect(state.types).toHaveBeenCalledWith({ pluginID, route: { connection: connectionID } });
  expect(state.groups).toHaveBeenCalledWith({ pluginID, route: { connection: connectionID } });
  expect(screen.getByTestId('resource-table').textContent).toBe(JSON.stringify([pluginID, connectionID, state.type]));
  expect(screen.getByRole('link', { name: 'Edit connection profile' })).toHaveAttribute('href', connectionProfilePath(pluginID, connectionID));
  expect(screen.getByRole('link', { name: 'Connection profiles' })).toHaveAttribute('href', connectionProfilesPath(pluginID));
});
