// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SnackbarProvider, useSnackbar } from './useSnackbar';

const toast = vi.hoisted(() => vi.fn());
vi.mock('@omniviewdev/base-ui', () => ({
  useToast: () => ({ toast }),
  Button: ({ children, onClick }: React.PropsWithChildren<{ onClick?: React.MouseEventHandler<HTMLButtonElement> }>) =>
    <button onClick={onClick}>{children}</button>,
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function Trigger({ actions = [] }: { actions?: Array<{ label: string; onClick: () => void }> }) {
  const { showSnackbar, openNotifications, notificationCount } = useSnackbar();
  return <><button onClick={() => showSnackbar({
    message: 'Installation failed', status: 'error', details: 'Source: /tmp/plugin\ncompiler error <unsafe>', actions,
  })}>Fail</button><button onClick={openNotifications}>Notifications ({notificationCount})</button></>;
}

describe('notification diagnostics', () => {
  it('keeps errors discoverable after toast dismissal and exposes every action', () => {
    const settings = vi.fn();
    const retry = vi.fn();
    render(<SnackbarProvider><Trigger actions={[
      { label: 'Settings', onClick: settings }, { label: 'Retry', onClick: retry },
    ]} /></SnackbarProvider>);
    fireEvent.click(screen.getByText('Fail'));
    expect(toast.mock.calls[0][1].action.label).toBe('Details');
    fireEvent.click(screen.getByText('Notifications (1)'));
    expect(screen.getByText('Source: /tmp/plugin\ncompiler error <unsafe>', { normalizer: value => value })).toBeTruthy();
    fireEvent.click(screen.getByText('Settings'));
    fireEvent.click(screen.getByText('Retry'));
    expect(settings).toHaveBeenCalledOnce();
    expect(retry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText('Clear history'));
    expect(screen.queryByText('Notifications (1)')).toBeNull();
  });

  it('opens details from toast and copies plain diagnostic text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<SnackbarProvider><Trigger /></SnackbarProvider>);
    fireEvent.click(screen.getByText('Fail'));
    act(() => toast.mock.calls[0][1].action.onClick());
    fireEvent.click(screen.getByText('Copy details'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('compiler error <unsafe>'));
    expect(screen.getByLabelText('Notifications').querySelector('unsafe')).toBeNull();
  });

  it('bounds session history to twenty errors without writing browser storage', () => {
    const store = vi.spyOn(Storage.prototype, 'setItem');
    render(<SnackbarProvider><Trigger /></SnackbarProvider>);
    for (let index = 0; index < 25; index++) fireEvent.click(screen.getByText('Fail'));
    expect(screen.getByText('Notifications (20)')).toBeTruthy();
    expect(store).not.toHaveBeenCalled();
    store.mockRestore();
  });
});
