import React from 'react';
import { render, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  OperationsProvider,
  OperationsContext,
  type Operation,
  type OperationsContextType,
} from '@omniviewdev/runtime';

// Helper to access the context value from within the provider.
function renderWithOperations() {
  let contextValue: OperationsContextType | undefined;

  function Consumer() {
    contextValue = React.useContext(OperationsContext);
    return null;
  }

  const utils = render(
    <OperationsProvider>
      <Consumer />
    </OperationsProvider>,
  );

  return {
    ...utils,
    getContext: () => contextValue!,
  };
}

function makeOperation(overrides: Partial<Operation> = {}): Operation {
  return {
    id: 'op-1',
    label: 'Restart',
    resourceKey: 'apps::v1::Deployment',
    resourceName: 'nginx',
    namespace: 'default',
    connectionID: 'cluster-1',
    status: 'running',
    startedAt: Date.now(),
    ...overrides,
  };
}

describe('OperationsContext', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('addOperation adds to operations list', () => {
    const { getContext } = renderWithOperations();
    const op = makeOperation();

    act(() => {
      getContext().addOperation(op);
    });

    expect(getContext().operations).toHaveLength(1);
    expect(getContext().operations[0].id).toBe('op-1');
  });

  it('updateOperation merges partial updates', () => {
    const { getContext } = renderWithOperations();
    const op = makeOperation();

    act(() => {
      getContext().addOperation(op);
    });
    act(() => {
      getContext().updateOperation('op-1', { status: 'completed', completedAt: Date.now() });
    });

    expect(getContext().operations[0].status).toBe('completed');
    expect(getContext().operations[0].label).toBe('Restart'); // unchanged
  });

  it('removeOperation filters out by id', () => {
    const { getContext } = renderWithOperations();

    act(() => {
      getContext().addOperation(makeOperation({ id: 'op-1' }));
      getContext().addOperation(makeOperation({ id: 'op-2' }));
    });
    act(() => {
      getContext().removeOperation('op-1');
    });

    expect(getContext().operations).toHaveLength(1);
    expect(getContext().operations[0].id).toBe('op-2');
  });

  it('auto-removes completed operations after delay', () => {
    const { getContext } = renderWithOperations();

    act(() => {
      getContext().addOperation(makeOperation({ id: 'op-done', status: 'completed', completedAt: Date.now() }));
    });

    expect(getContext().operations).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(getContext().operations).toHaveLength(0);
  });

  it('auto-removes errored operations after delay', () => {
    const { getContext } = renderWithOperations();

    act(() => {
      getContext().addOperation(makeOperation({ id: 'op-err', status: 'error', completedAt: Date.now() }));
    });

    expect(getContext().operations).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(getContext().operations).toHaveLength(0);
  });

  it('does not auto-remove running operations', () => {
    const { getContext } = renderWithOperations();

    act(() => {
      getContext().addOperation(makeOperation({ id: 'op-run', status: 'running' }));
    });

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(getContext().operations).toHaveLength(1);
    expect(getContext().operations[0].id).toBe('op-run');
  });
});
