import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useBottomDrawer } from '@omniviewdev/runtime';
import { SessionOptions } from '@omniviewdev/runtime/models';
import BottomDrawerProvider from '../provider';
import BottomDrawerTabs from '../tabs';
import { bottomDrawerChannel } from '../events';
import type * as DrawerContextModule from '../../../../packages/omniviewdev-runtime/src/context/drawer/BottomDrawerContext';

const backend = vi.hoisted(() => ({
  create: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@omniviewdev/runtime', async () => {
  // The hoisted mock must load the real context before static imports initialize.
  const { BottomDrawerContext } = await vi.importActual<typeof DrawerContextModule>(
    '../../../../packages/omniviewdev-runtime/src/context/drawer/BottomDrawerContext',
  );
  const { useContext } = await vi.importActual<typeof React>('react');
  return {
    BottomDrawerContext,
    useBottomDrawer: () => useContext(BottomDrawerContext),
    useSettings: () => ({ settings: {} }),
    useSnackbar: () => ({ showSnackbar: vi.fn() }),
    showAppError: vi.fn(),
    parseAppError: (error: Error) => ({ detail: error.message }),
  };
});

vi.mock('@omniviewdev/runtime/api', () => ({
  ExecClient: {
    CreateSession: backend.create,
    CloseSession: backend.close,
    ListSessions: vi.fn().mockResolvedValue([]),
  },
  LogsClient: { ListSessions: vi.fn().mockResolvedValue([]) },
  WindowClient: { ListStates: vi.fn().mockResolvedValue({}) },
}));
vi.mock('@/features/windows', () => ({
  DRAWER_TAB_DRAG_TYPE: 'omniview/drawer-tab',
  currentWindow: { name: 'main', kind: 'workspace', isMain: true },
  readInitialSlot: () => null,
  saveSlot: vi.fn(),
  onWindowClosed: () => vi.fn(),
  useTabDeliveries: vi.fn(),
  useWindowsList: () => [],
  openWindow: vi.fn(),
  deliverTabToWindow: vi.fn(),
}));
vi.mock('@omniviewdev/runtime/models', () => ({
  SessionOptions: { createFrom: (value: unknown) => value },
  CreateSessionOptions: { createFrom: (value: unknown) => value },
  LogSessionOptions: { createFrom: (value: unknown) => value },
}));
vi.mock('@omniviewdev/runtime/runtime', () => ({ Events: { On: vi.fn(() => vi.fn()) } }));
vi.mock('@/features/logger', () => ({ default: { error: vi.fn() } }));
vi.mock('@/components/icons/Icon', () => ({ default: () => null }));

function Harness({ index }: { index: number }) {
  const drawer = useBottomDrawer();
  return <>
    <button onClick={() => {
      drawer.createTabs([
        { id: 'exec-old', title: 'Exec', variant: 'terminal', properties: { status: 'connected' } },
        { id: 'logs', title: 'Logs', variant: 'logs' },
        { id: 'other', title: 'Other', variant: 'logs' },
      ]);
    }}>Seed</button>
    <button onClick={() => {
      drawer.focusTab({ index });
    }}>Focus</button>
    <button onClick={() => {
      bottomDrawerChannel.emit('onCreateSession', {
        plugin: 'kubernetes', connection: 'kind-kind',
        opts: SessionOptions.createFrom({ command: ['sh'] }),
        label: 'Exec', replaceSessionId: 'exec-old',
      });
    }}>Retry</button>
    <output data-testid="state">{JSON.stringify({
      ids: drawer.tabs.map(tab => tab.id),
      focused: drawer.tabs[drawer.focused]?.title,
      status: drawer.tabs[0]?.properties?.status,
      error: drawer.tabs[0]?.properties?.error,
    })}</output>
    <BottomDrawerTabs />
  </>;
}

function state() {
  return JSON.parse(screen.getByTestId('state').textContent);
}

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

it.each([0, 1, 2])('keeps tab order and focused tab %i while retry connects', async index => {
  const { promise, resolve } = Promise.withResolvers<{ id: string }>();
  backend.create.mockReturnValue(promise);
  render(<BottomDrawerProvider><Harness index={index} /></BottomDrawerProvider>);
  fireEvent.click(screen.getByText('Seed'));
  fireEvent.click(screen.getByText('Focus'));
  fireEvent.click(screen.getByText('Retry'));
  expect(state()).toEqual({ ids: [expect.stringMatching(/^pending-/), 'logs', 'other'],
    focused: ['Exec', 'Logs', 'Other'][index], status: 'connecting' });
  await act(async () => {
    resolve({ id: 'exec-new' });
  });
  expect(state()).toEqual({ ids: ['exec-new', 'logs', 'other'],
    focused: ['Exec', 'Logs', 'Other'][index], status: 'connected' });
  expect(backend.close).toHaveBeenCalledWith('exec-old');
});

it('keeps failed retry in its original slot without selecting logs', async () => {
  const { promise, reject } = Promise.withResolvers<{ id: string }>();
  backend.create.mockReturnValue(promise);
  const errorLog = vi.spyOn(console, 'error').mockImplementation(vi.fn());
  try {
    render(<BottomDrawerProvider><Harness index={0} /></BottomDrawerProvider>);
    fireEvent.click(screen.getByText('Seed'));
    fireEvent.click(screen.getByText('Retry'));
    await act(async () => {
      reject(new Error('Shell not found'));
    });
    expect(state()).toEqual({ ids: [expect.stringMatching(/^pending-/), 'logs', 'other'],
      focused: 'Exec', status: 'error', error: 'Shell not found' });
  } finally {
    errorLog.mockRestore();
  }
});
