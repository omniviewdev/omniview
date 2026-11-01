import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostRecord } from '@omniviewdev/runtime';
import { Handler } from '@omniviewdev/runtime/models';
import ExecAction from './ExecAction';

const native = vi.hoisted(() => ({ supported: false, pending: false, open: vi.fn(), emit: vi.fn() }));
vi.mock('@omniviewdev/runtime', () => ({
  useNativeExec: () => ({ isSupported: native.supported, isPending: native.pending, openNativeSession: native.open }),
}));
vi.mock('@/providers/BottomDrawer/events', () => ({ bottomDrawerChannel: { emit: native.emit } }));
vi.mock('./ActionMenuListItem', () => ({ default: ({ menu }: { menu: React.ReactNode }) => <div>{menu}</div> }));
vi.mock('@omniviewdev/base-ui', () => ({
  Menu: {
    Item: ({ children, closeOnClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { closeOnClick?: boolean }) => (
      <button {...props} data-close-on-click={closeOnClick}>{children}</button>
    ),
    Separator: () => <hr />,
  },
}));

const reference = { address: { provider: 'kubernetes', authority: 'cluster', type: 'pods', id: 'pod-1', scope: [] }, incarnation: 'uid-1' };
const record: HostRecord = {
  key: 'opaque-host-key', addressKey: 'opaque-address-key', targetId: 'observed-target',
  record: {
    reference,
    body: { kind: 'map', value: { generation: { kind: 'int64', value: '9223372036854775807' } } },
    representation: { id: 'json', revision: '1', schema: { state: 'absent', validation: 'none', unvalidated: [] } },
    coverage: { kind: 'complete', paths: [] },
  },
  route: { connection: 'selected-connection' },
};
function props() {
  return {
    selected: true,
    handleSelect: vi.fn(), handleDeselect: vi.fn(), handleLeaveMenu: vi.fn(), handleDismiss: vi.fn(),
    itemProps: { onClick: vi.fn() },
    plugin: 'kubernetes', connection: 'selected-connection', resource: 'pods',
    action: Handler.createFrom({
      target_builder: { paths: ['$.spec.containers[*]'], selectors: { container: '$.name' }, label_selector: 'container', label: '' },
      default_command: ['/bin/sh'], supports_native_command: true,
    }),
    data: { spec: { containers: [{ name: 'app' }, { name: 'sidecar' }], initContainers: [{ name: 'init' }] } },
    record,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  native.supported = false;
  native.pending = false;
  native.open.mockResolvedValue(true);
});
afterEach(cleanup);

describe('resource Exec destinations', () => {
  it('keeps built-in rows unchanged and hides native rows without capability', () => {
    const actions = props();
    render(<ExecAction {...actions} />);
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['app', 'sidecar']);
    expect(screen.queryByRole('separator')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'app' }));
    expect(native.emit).toHaveBeenCalledWith('onCreateSession', expect.objectContaining({
      plugin: 'kubernetes', connection: 'selected-connection', label: 'app',
      opts: expect.objectContaining({ reference, route: record.route, resource_data: record.record.body, params: { container: 'app' } }),
    }));
    expect(native.open).not.toHaveBeenCalled();
    expect(actions.handleDismiss).toHaveBeenCalledOnce();
  });

  it('adds explicitly labeled ordinary container native rows after the built-in rows and separator', async () => {
    native.supported = true;
    const actions = props();
    render(<ExecAction {...actions} />);
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual([
      'app', 'sidecar', 'app — Open in Native Terminal', 'sidecar — Open in Native Terminal',
    ]);
    expect(screen.getByRole('separator')).toBeTruthy();
    expect(screen.queryByText('init — Open in Native Terminal')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'sidecar — Open in Native Terminal' })); 
    });
    expect(native.open).toHaveBeenCalledWith({
      connectionID: 'selected-connection',
      opts: expect.objectContaining({ reference, route: record.route, resource_data: record.record.body, params: { container: 'sidecar' }, command: ['/bin/sh'] }),
    });
    expect(native.emit).not.toHaveBeenCalled();
    expect(actions.handleDismiss).toHaveBeenCalledOnce();
  });

  it('keeps the menu open after a native failure without an integrated fallback', async () => {
    native.supported = true;
    native.open.mockResolvedValue(false);
    const actions = props();
    render(<ExecAction {...actions} />);
    const item = screen.getByRole('button', { name: 'app — Open in Native Terminal' });
    expect(item.getAttribute('data-close-on-click')).toBe('false');
    await act(async () => {
      fireEvent.click(item); 
    });
    expect(actions.handleDismiss).not.toHaveBeenCalled();
    expect(actions.handleDeselect).not.toHaveBeenCalled();
    expect(actions.itemProps.onClick).not.toHaveBeenCalled();
    expect(native.emit).not.toHaveBeenCalled();
  });

  it('disables every native target while pending without changing built-in row availability', () => {
    native.supported = true;
    native.pending = true;
    render(<ExecAction {...props()} />);
    const item = screen.getByRole<HTMLButtonElement>('button', { name: 'app — Open in Native Terminal' });
    expect(item.disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'sidecar — Open in Native Terminal' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'app' }).disabled).toBe(false);
    fireEvent.click(item);
    expect(native.open).not.toHaveBeenCalled();
  });
});
