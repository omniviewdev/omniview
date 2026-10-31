import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
import type * as Runtime from '@omniviewdev/runtime';
import type { ConnectionProfile } from '@omniviewdev/runtime';
import { Connection } from '@omniviewdev/runtime/models';
import ConnectionDetails from './ConnectionDetails';
import { connectionProfilePath } from '@/features/workspace/pagePaths';

const mocks = vi.hoisted(() => ({
  profiles: [] as ConnectionProfile[],
  effective: ((): unknown => undefined)(),
  save: vi.fn(), importProfile: vi.fn(), reset: vi.fn(), remove: vi.fn(),
  useConnection: vi.fn(), useConnectionProfiles: vi.fn(),
}));
vi.mock('@omniviewdev/runtime', async () => {
  const actual = await vi.importActual<typeof Runtime>('@omniviewdev/runtime');
  return {
    ...actual,
    useConnectionProfiles: (options: unknown) => {
      mocks.useConnectionProfiles(options);
      return { profiles: { data: mocks.profiles, isLoading: false, isError: false } };
    },
    useConnection: (options: unknown) => {
      mocks.useConnection(options);
      return {
        connection: { data: mocks.effective, isLoading: false },
        saveConnectionProfile: mocks.save, importConnectionProfile: mocks.importProfile,
        resetConnectionProfile: mocks.reset, removeConnection: mocks.remove,
      };
    },
  };
});
vi.mock('@omniviewdev/base-ui', () => {
  const Container = ({ children }: HTMLAttributes<HTMLDivElement>) => <div>{children}</div>;
  const Grid = Object.assign(Container, { Item: Container });
  const Banner = Object.assign(Container, { Content: Container, Title: Container });
  return {
    Grid, Banner, Stack: Container, Text: Container, Avatar: () => null,
    Button: ({ children, color: _color, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { color?: string }) => <button {...props}>{children}</button>,
    TextField: { Root: Container, Control: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} /> },
    TextArea: { Root: Container, Control: (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} /> },
  };
});

const effective = Connection.createFrom({ id: 'route', name: 'Native', description: 'Source', data: { endpoint: 'https://old.example' }, labels: {} });
function open(pluginID = 'provider', connectionID = 'route') {
  return render(<MemoryRouter initialEntries={[connectionProfilePath(pluginID, connectionID)]}>
    <Routes><Route path="/connections/:pluginID/:connectionID/edit" element={<ConnectionDetails />} /></Routes>
  </MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.effective = effective;
  mocks.profiles = [{ id: 'route', source: 'native', active: true, connection: effective }];
  mocks.save.mockResolvedValue({ applied: true, profile: mocks.profiles[0] });
  mocks.importProfile.mockResolvedValue({ applied: true, profile: mocks.profiles[0] });
  mocks.reset.mockResolvedValue({ applied: true, profile: mocks.profiles[0] });
  mocks.remove.mockResolvedValue(undefined);
});

it('resets drafts and pending state across plugin routes and ignores the retired save', async () => {
  const save = Promise.withResolvers<unknown>();
  mocks.save.mockReturnValueOnce(save.promise);
  function NavigateProfile() {
    const navigate = useNavigate();
    return <button onClick={async () => {
      await navigate(connectionProfilePath('other-provider', 'route')); 
    }}>Other profile</button>;
  }

  render(<MemoryRouter initialEntries={[connectionProfilePath('provider', 'route')]}>
    <NavigateProfile />
    <Routes><Route path="/connections/:pluginID/:connectionID/edit" element={<ConnectionDetails />} /></Routes>
  </MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Connection name'), { target: { value: 'Unsaved draft' } });
  fireEvent.click(screen.getByText('Save and apply'));
  expect(screen.getByText('Applying…')).toBeDisabled();
  await act(async () => {
    fireEvent.click(screen.getByText('Other profile')); 
  });
  expect(screen.getByLabelText('Connection name')).toHaveValue('Native');
  expect(screen.getByText('Save and apply')).not.toBeDisabled();
  await act(async () => {
    save.resolve({ applied: true }); 
  });
  expect(screen.queryByText('Source change applied and desired configuration saved.')).toBeNull();
  expect(mocks.useConnection).toHaveBeenLastCalledWith(expect.objectContaining({ pluginID: 'other-provider', connectionID: 'route' }));
});

it('does not report success until source apply and durable save finish', async () => {
  const save = Promise.withResolvers<unknown>();
  mocks.save.mockReturnValue(save.promise);
  open();
  fireEvent.change(screen.getByLabelText('Desired source configuration'), { target: { value: '{"endpoint":"https://new.example"}' } });
  fireEvent.click(screen.getByText('Save and apply'));
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'route', data: { endpoint: 'https://new.example' } }));
  expect(screen.queryByText('Source change applied and desired configuration saved.')).toBeNull();
  expect(screen.getByText('Applying…')).toBeDisabled();
  expect(screen.getByText(/old.example/)).toBeTruthy();
  await act(async () => {
    save.resolve({ applied: true }); 
  });
  expect(screen.getByText('Source change applied and desired configuration saved.')).toBeTruthy();
});

it.each([
  { code: 'CONFLICT', detail: 'Connection profile was not applied. Provider rejected the desired endpoint.' },
  { code: 'RESET_REQUIRED', detail: 'Rollback failed; actual source state is unknown.' },
])('keeps effective state separate and shows typed $code failure', async ({ code, detail }) => {
  mocks.save.mockRejectedValue({ type: 'omniview:connection/profile', title: 'Connection change failed', status: 409, code, detail });
  open();
  fireEvent.change(screen.getByLabelText('Desired source configuration'), { target: { value: '{"endpoint":"https://new.example"}' } });
  await act(async () => fireEvent.click(screen.getByText('Save and apply')));
  expect(screen.getByText(`Connection change failed (${code})`)).toBeTruthy();
  expect(screen.getByText(detail)).toBeTruthy();
  expect(screen.queryByText('Source change applied and desired configuration saved.')).toBeNull();
  expect(screen.getByLabelText('Desired source configuration')).toHaveValue('{"endpoint":"https://new.example"}');
  if (code === 'RESET_REQUIRED') {
    expect(screen.getByText('Actual source state is unknown.')).toBeTruthy();
    expect(screen.queryByText(/old.example/)).toBeNull();
  } else {
    expect(screen.getByText(/old.example/)).toBeTruthy();
  }
});

it('keeps legacy review entries inactive until explicit import', async () => {
  mocks.profiles = [{ id: 'route', source: 'review', active: false, connection: effective }];
  mocks.effective = undefined;
  open();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.importProfile).not.toHaveBeenCalled();
  expect(mocks.useConnection).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  expect(screen.getByText(/saved discovery entry is inactive/)).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByText('Import reviewed profile')));
  expect(mocks.importProfile).toHaveBeenCalledOnce();
});

it('restores a disabled native route even when no effective configuration exists', async () => {
  mocks.profiles = [{ id: 'route', source: 'disabled', active: false }];
  mocks.effective = undefined;
  open();
  expect(screen.getByText(/Native configuration files have not been changed/)).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByText('Reset / restore native configuration')));
  expect(mocks.reset).toHaveBeenCalledOnce();
});

it.each(['native', 'manual'] as const)('uses host-owned removal for a %s profile', async (source) => {
  mocks.profiles = [{ id: 'route', source, active: true, connection: effective }];
  open();
  await act(async () => fireEvent.click(screen.getByText(source === 'manual' ? 'Delete saved profile' : 'Disable in Omniview')));
  expect(mocks.remove).toHaveBeenCalledOnce();
  expect(mocks.save).not.toHaveBeenCalled();
});

it('does not apply invalid desired JSON', async () => {
  open();
  fireEvent.change(screen.getByLabelText('Desired source configuration'), { target: { value: '[' } });
  await act(async () => fireEvent.click(screen.getByText('Save and apply')));
  expect(mocks.save).not.toHaveBeenCalled();
  expect(screen.getByText(/Connection change failed/)).toBeTruthy();
});

it.each(['prod/blue', 'prod%2Fblue', 'prod%252Fblue'])('edits the exact opaque host profile %s', async (connectionID) => {
  const pluginID = 'provider%2Fopaque';
  const connection = Connection.createFrom({ ...effective, id: connectionID });
  mocks.profiles = [{ id: connectionID, source: 'native', active: true, connection }];
  open(pluginID, connectionID);
  expect(mocks.useConnectionProfiles).toHaveBeenCalledWith({ pluginID });
  expect(mocks.useConnection).toHaveBeenCalledWith({ pluginID, connectionID, enabled: true });
  await act(async () => fireEvent.click(screen.getByText('Save and apply')));
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ id: connectionID }));
});
