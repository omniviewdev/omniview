import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useBottomDrawer, type BottomDrawerContextType } from '@omniviewdev/runtime';

import BottomDrawerProvider from '../provider';
import { consumeTerminalSessionHandoff } from '../terminalHandoff';
import { useBottomDrawerWindow, type BottomDrawerWindowContextType } from '../windowContext';
import type { DrawerSlot, SerializedDrawerTab } from '../drawerSlot';
import type { ClosedWindowEvent } from '@/features/windows';

const mocks = vi.hoisted(() => ({
  mockEmit: vi.fn(),
  initialSlot: null as DrawerSlot | null,
  closedHandlers: new Set<(event: ClosedWindowEvent) => void>(),
  takeDeliveredTab: null as ((payload: unknown) => boolean) | null,
  listExecSessions: vi.fn(),
  listLogSessions: vi.fn(),
  listStates: vi.fn(),
  closeSession: vi.fn(),
}));

vi.mock('@/providers/BottomDrawer/events', () => ({
  bottomDrawerChannel: {
    emit: (...args: [string, ...any[]]) => mocks.mockEmit(...args),
  },
}));

vi.mock('@/features/logger', () => ({ default: { error: vi.fn() } }));

vi.mock('@/features/windows', () => ({
  DRAWER_TAB_DRAG_TYPE: 'omniview/drawer-tab',
  currentWindow: { name: 'main', kind: 'workspace', isMain: true },
  readInitialSlot: (_slot: string, parse: (value: unknown) => unknown) =>
    mocks.initialSlot === null ? null : parse(mocks.initialSlot),
  saveSlot: vi.fn(),
  onWindowClosed: (handler: (event: ClosedWindowEvent) => void) => {
    mocks.closedHandlers.add(handler);
    return () => mocks.closedHandlers.delete(handler);
  },
  useTabDeliveries: (_dragType: string, takeTab: (payload: unknown) => boolean) => {
    mocks.takeDeliveredTab = takeTab;
  },
}));

vi.mock('@omniviewdev/runtime/api', () => ({
  ExecClient: { ListSessions: mocks.listExecSessions, CloseSession: mocks.closeSession },
  LogsClient: { ListSessions: mocks.listLogSessions },
  WindowClient: { ListStates: mocks.listStates },
}));

const created = '2026-10-29T08:00:00.000Z';

function serializedTab(id: string, variant: SerializedDrawerTab['variant'] = 'terminal'): SerializedDrawerTab {
  return { id, title: id, variant, createdAt: created, updatedAt: created };
}

function slotOf(tabs: SerializedDrawerTab[], focusedId: string | null = null): DrawerSlot {
  return { version: 1, tabs, focusedId };
}

let drawer: BottomDrawerContextType;
let drawerWindow: BottomDrawerWindowContextType;

function Probe() {
  drawer = useBottomDrawer();
  drawerWindow = useBottomDrawerWindow();
  return null;
}

function TestHarness() {
  const bottomDrawer = useBottomDrawer();

  return (
    <>
      <div data-testid="tab-count">{bottomDrawer.tabs.length}</div>
      <button
        data-testid="create-empty"
        onClick={() => {
          bottomDrawer.createTabs([]);
        }}
      >
        create-empty
      </button>
      <button
        data-testid="create-one"
        onClick={() => {
          bottomDrawer.createTabs([{
            id: 'tab-1',
            title: 'Session 1',
            variant: 'terminal',
            icon: 'LuSquareTerminal',
          }]);
        }}
      >
        create-one
      </button>
    </>
  );
}

const tabIds = () => drawer.tabs.map((tab) => tab.id);
const focusedTabId = () => drawer.tabs[drawer.focused]?.id;

async function renderRestoredDrawer() {
  render(<BottomDrawerProvider><Probe /></BottomDrawerProvider>);
  await waitFor(() => {
    expect(drawerWindow.restoreComplete).toBe(true);
  });
}

describe('BottomDrawerProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.initialSlot = null;
    mocks.closedHandlers.clear();
    mocks.takeDeliveredTab = null;
    mocks.listExecSessions.mockResolvedValue([]);
    mocks.listLogSessions.mockResolvedValue([]);
    mocks.listStates.mockResolvedValue({});
    mocks.closeSession.mockResolvedValue(undefined);
  });

  it('createTabs([]) is a no-op and does not emit onTabCreated', () => {
    render(
      <BottomDrawerProvider>
        <TestHarness />
      </BottomDrawerProvider>,
    );

    expect(screen.getByTestId('tab-count').textContent).toBe('0');

    fireEvent.click(screen.getByTestId('create-empty'));

    expect(screen.getByTestId('tab-count').textContent).toBe('0');
    expect(mocks.mockEmit).not.toHaveBeenCalled();
  });

  it('createTabs([tab]) appends tabs and emits onTabCreated', () => {
    render(
      <BottomDrawerProvider>
        <TestHarness />
      </BottomDrawerProvider>,
    );

    fireEvent.click(screen.getByTestId('create-one'));

    expect(screen.getByTestId('tab-count').textContent).toBe('1');
    expect(mocks.mockEmit).toHaveBeenCalledTimes(1);
    expect(mocks.mockEmit).toHaveBeenCalledWith('onTabCreated');
  });

  it('transferring a terminal out removes the tab but keeps its session alive', async () => {
    mocks.initialSlot = slotOf([serializedTab('sess-1'), serializedTab('sess-2')], 'sess-1');
    mocks.listExecSessions.mockResolvedValue([{ id: 'sess-1', labels: {} }, { id: 'sess-2', labels: {} }]);
    await renderRestoredDrawer();

    act(() => {
      drawerWindow.transferTabOut('sess-1');
    });

    expect(tabIds()).toEqual(['sess-2']);
    expect(mocks.closeSession).not.toHaveBeenCalled();
    // The unmounting terminal skips its detach so the target window stays attached.
    expect(consumeTerminalSessionHandoff('sess-1')).toBe(true);

    act(() => {
      drawer.closeTab({ id: 'sess-2' });
    });
    expect(mocks.closeSession).toHaveBeenCalledWith('sess-2');
  });

  it('main window adopts surviving sessions except those another window claims', async () => {
    mocks.initialSlot = slotOf([serializedTab('sess-own')], 'sess-own');
    mocks.listExecSessions.mockResolvedValue([
      { id: 'sess-own', labels: {} },
      { id: 'sess-orphan', labels: { shell: 'zsh' } },
      { id: 'sess-moved', labels: {} },
    ]);
    mocks.listStates.mockResolvedValue({
      'main': { drawer: JSON.stringify(slotOf([serializedTab('sess-own')])) },
      'w-1a2b3c4d': { drawer: JSON.stringify(slotOf([serializedTab('sess-moved')], 'sess-moved')) },
    });

    await renderRestoredDrawer();

    expect(tabIds()).toEqual(['sess-own', 'sess-orphan']);
    expect(drawer.tabs[1]).toMatchObject({ variant: 'terminal', icon: 'LuSquareTerminal', properties: { shell: 'zsh' } });
    expect(focusedTabId()).toBe('sess-own');
    expect(drawerWindow.quietTabIds.has('sess-orphan')).toBe(true);
  });

  it('drops restored tabs whose backend session no longer exists', async () => {
    mocks.initialSlot = slotOf(
      [serializedTab('sess-dead'), serializedTab('log-dead', 'logs'), serializedTab('devbuild-kubernetes', 'devbuild')],
      'devbuild-kubernetes',
    );

    await renderRestoredDrawer();

    expect(tabIds()).toEqual(['devbuild-kubernetes']);
    expect(focusedTabId()).toBe('devbuild-kubernetes');
  });

  it('appends the drawer tabs of a closed window without stealing focus', async () => {
    mocks.initialSlot = slotOf([serializedTab('sess-a'), serializedTab('sess-b')], 'sess-a');
    mocks.listExecSessions.mockResolvedValue([{ id: 'sess-a', labels: {} }, { id: 'sess-b', labels: {} }]);
    await renderRestoredDrawer();

    act(() => {
      for (const handler of mocks.closedHandlers) {
        handler({
          name: 'w-1a2b3c4d',
          kind: 'panel',
          states: { drawer: JSON.stringify(slotOf([serializedTab('sess-c'), serializedTab('sess-a')], 'sess-c')) },
        });
      }
    });

    expect(tabIds()).toEqual(['sess-a', 'sess-b', 'sess-c']);
    expect(focusedTabId()).toBe('sess-a');
    expect(drawerWindow.quietTabIds.has('sess-c')).toBe(true);
  });

  it('focuses the closed window\'s focused tab when the drawer was empty', async () => {
    await renderRestoredDrawer();

    act(() => {
      for (const handler of mocks.closedHandlers) {
        handler({
          name: 'w-1a2b3c4d',
          kind: 'workspace',
          states: { drawer: JSON.stringify(slotOf([serializedTab('sess-c'), serializedTab('sess-d')], 'sess-d')) },
        });
      }
    });

    expect(tabIds()).toEqual(['sess-c', 'sess-d']);
    expect(focusedTabId()).toBe('sess-d');
    expect(drawerWindow.quietTabIds.has('sess-d')).toBe(false);
  });

  it('takes delivered tabs, refusing pending and already present ones', async () => {
    mocks.initialSlot = slotOf([serializedTab('sess-a')], 'sess-a');
    mocks.listExecSessions.mockResolvedValue([{ id: 'sess-a', labels: {} }]);
    await renderRestoredDrawer();
    const takeDeliveredTab = mocks.takeDeliveredTab!;

    let accepted = false;
    act(() => {
      accepted = takeDeliveredTab(serializedTab('sess-b'));
    });
    expect(accepted).toBe(true);
    expect(tabIds()).toEqual(['sess-a', 'sess-b']);
    expect(focusedTabId()).toBe('sess-b');

    expect(takeDeliveredTab(serializedTab('pending-1'))).toBe(false);
    expect(takeDeliveredTab(serializedTab('sess-a'))).toBe(false);
    expect(() => takeDeliveredTab({ id: 'sess-x' })).toThrow();
    expect(tabIds()).toEqual(['sess-a', 'sess-b']);
  });

  it('adopts a dropped tab at the insert index and focuses it', async () => {
    mocks.initialSlot = slotOf([serializedTab('sess-a'), serializedTab('sess-b')], 'sess-a');
    mocks.listExecSessions.mockResolvedValue([{ id: 'sess-a', labels: {} }, { id: 'sess-b', labels: {} }]);
    await renderRestoredDrawer();

    act(() => {
      drawerWindow.adoptTabs([serializedTab('log-1', 'logs')], { index: 1, focusTabId: 'log-1' });
    });

    expect(tabIds()).toEqual(['sess-a', 'log-1', 'sess-b']);
    expect(focusedTabId()).toBe('log-1');
    expect(drawer.tabs[1].icon).toBe('LuLogs');
  });
});
