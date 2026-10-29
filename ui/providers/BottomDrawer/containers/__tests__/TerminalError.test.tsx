import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import TerminalError from '../TerminalError';

vi.mock('@omniviewdev/base-ui', () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  Text: (props: React.HTMLAttributes<HTMLSpanElement>) => <span {...props} />,
}));

const error = { title: 'Shell not found', suggestion: 'This image has no shell.', raw: 'exec: sh: executable file not found', retryable: false };

describe('explicit terminal recovery', () => {
  it('does not start a recovery mutation until the user chooses it', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    render(<TerminalError error={error} onRetry={vi.fn()} recovery={{ label: 'Debug this container', run }} />);
    expect(run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Debug this container' }));
    await act(async () => {
      await Promise.resolve(); 
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('blocks duplicate recovery clicks and exposes a failed recovery without losing the original error', async () => {
    const deferred = Promise.withResolvers<void>();
    const run = vi.fn(async () => deferred.promise);
    render(<TerminalError error={error} onRetry={vi.fn()} recovery={{ label: 'Debug this container', run }} />);
    const button = screen.getByRole('button', { name: 'Debug this container' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(run).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    await act(async () => {
      deferred.reject(new Error('Debug access denied')); 
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Debug access denied');
    expect(screen.getByText('Shell not found')).toBeVisible();
    expect(button).toBeEnabled();
  });

  it('keeps alternate shell retries available after debugger recovery fails', async () => {
    render(<TerminalError
      error={{ ...error, retryable: true, retryCommands: ['/bin/ash'] }}
      onRetry={vi.fn()}
      recovery={{ label: 'Debug this container', run: async () => {
        throw new Error('Debug access denied'); 
      } }}
    />);
    expect(screen.getByRole('button', { name: '/bin/ash' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Debug this container' }));
    await screen.findByRole('status');
    expect(screen.getByRole('button', { name: '/bin/ash' })).toBeEnabled();
    expect(screen.getByText('Shell not found')).toBeVisible();
  });

  it('offers no mutation when the plugin did not supply a recovery action', () => {
    render(<TerminalError error={{ ...error, title: 'Permission denied' }} onRetry={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Debug this container' })).not.toBeInTheDocument();
  });
});
