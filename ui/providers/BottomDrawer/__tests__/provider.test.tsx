import { fireEvent, render, screen } from '@testing-library/react';
import { useBottomDrawer } from '@omniviewdev/runtime';

import BottomDrawerProvider from '../provider';

const mocks = vi.hoisted(() => ({
  mockEmit: vi.fn(),
}));

vi.mock('@/providers/BottomDrawer/events', () => ({
  bottomDrawerChannel: {
    emit: (...args: [string, ...any[]]) => mocks.mockEmit(...args),
  },
}));

function TestHarness() {
  const drawer = useBottomDrawer();

  return (
    <>
      <div data-testid="tab-count">{drawer.tabs.length}</div>
      <button
        data-testid="create-empty"
        onClick={() => drawer.createTabs([])}
      >
        create-empty
      </button>
      <button
        data-testid="create-one"
        onClick={() => {
          drawer.createTabs([{
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

describe('BottomDrawerProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
