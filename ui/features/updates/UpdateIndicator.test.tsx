import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ call: vi.fn(), openSettings: vi.fn(), status: {} as Record<string, unknown> }));
vi.mock('@wailsio/runtime', () => ({ Call: { ByName: mocks.call }, Events: { On: vi.fn(() => () => {}) } }));
vi.mock('@omniviewdev/runtime', () => ({ openSettings: mocks.openSettings, useConfirmationModal: () => ({ show: vi.fn() }) }));
vi.mock('@omniviewdev/base-ui', () => ({
  Button: ({ children, ...props }: React.ComponentProps<'button'>) => <button {...props}>{children}</button>,
}));
import { UpdateIndicator } from './UpdateIndicator';

describe('UpdateIndicator', () => {
  beforeEach(() => {
    mocks.openSettings.mockReset();
    mocks.call.mockReset().mockImplementation(async () => mocks.status);
  });
  afterEach(cleanup);

  it('offers a restart when an update is ready', async () => {
    mocks.status = { state: 'ready', availableVersion: '2.0.0', switchTarget: '' };
    render(<UpdateIndicator />);
    expect(await screen.findByRole('button', { name: 'Restart to Update' })).toBeTruthy();
  });

  it('opens the Updates page when an update is available', async () => {
    mocks.status = { state: 'available', availableVersion: '2.0.0' };
    render(<UpdateIndicator />);
    fireEvent.click(await screen.findByRole('button', { name: 'Update 2.0.0 available' }));
    expect(mocks.openSettings).toHaveBeenCalledWith('/settings?section=core&category=updates');
  });

  it('shows nothing for a background error', async () => {
    mocks.status = { state: 'error', error: 'network down' };
    const { container } = render(<UpdateIndicator />);
    await Promise.resolve();
    expect(container.textContent).toBe('');
  });
});
