import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ call: vi.fn(), show: vi.fn(), work: [] as Array<{ kind: string; description: string }> }));
vi.mock('@wailsio/runtime', () => ({ Call: { ByName: mocks.call } }));
vi.mock('@omniviewdev/runtime', () => ({ useConfirmationModal: () => ({ show: mocks.show }) }));
vi.mock('@omniviewdev/base-ui', () => ({
  Button: ({ children, ...props }: React.ComponentProps<'button'>) => <button {...props}>{children}</button>,
}));
import { RestartToUpdateButton } from './RestartToUpdateButton';
import type { UpdateStatus } from './types';

const status: UpdateStatus = {
  state: 'ready', version: '1.0.0', availableVersion: '2.0.0', error: '', channel: 'stable', switchTarget: '',
  canceled: false, releaseUrl: '', lastCheckedAt: '', unsupportedReason: '',
};

describe('RestartToUpdateButton', () => {
  beforeEach(() => {
    mocks.work = [];
    mocks.show.mockReset();
    mocks.call.mockReset().mockImplementation(async (method: string) => method.endsWith('.ActiveWork') ? mocks.work : undefined);
  });
  afterEach(cleanup);

  it('restarts at once when no work is active', async () => {
    render(<RestartToUpdateButton status={status} onError={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Restart to Update' }));
    await waitFor(() => {
      expect(mocks.call).toHaveBeenCalledWith('main.UpdateService.Restart', false);
    });
    expect(mocks.show).not.toHaveBeenCalled();
  });

  it('lists active work and restarts only after confirmation', async () => {
    mocks.work = [{ kind: 'terminal', description: 'Terminal: bash' }];
    render(<RestartToUpdateButton status={status} onError={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Restart to Update' }));
    await waitFor(() => {
      expect(mocks.show).toHaveBeenCalledTimes(1);
    });
    const options = mocks.show.mock.calls[0][0] as { title: string; body: React.ReactNode; confirmLabel: string; cancelLabel: string; onConfirm: () => Promise<void> };
    expect(options).toMatchObject({ title: 'Restart Omniview?', confirmLabel: 'Restart anyway', cancelLabel: 'Cancel' });
    render(<>{options.body}</>);
    expect(screen.getByText('Terminal: bash')).toBeTruthy();
    expect(mocks.call).not.toHaveBeenCalledWith('main.UpdateService.Restart', expect.anything());
    await options.onConfirm();
    expect(mocks.call).toHaveBeenCalledWith('main.UpdateService.Restart', true);
  });

  it('asks for confirmation when work starts after the listing', async () => {
    let listings = 0;
    mocks.call.mockImplementation(async (method: string) => {
      if (method.endsWith('.ActiveWork')) {
        listings++;
        return listings === 1 ? [] : [{ kind: 'port-forward', description: 'Port forward: localhost:8080 → 80' }];
      }

      throw new Error('active work would be lost; confirm restart');
    });
    render(<RestartToUpdateButton status={status} onError={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Restart to Update' }));
    await waitFor(() => {
      expect(mocks.show).toHaveBeenCalledTimes(1);
    });
  });
});
