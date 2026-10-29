import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBoundary } from 'react-error-boundary';
import { isDev } from '@/utils/env';
import { FullPageErrorFallback, PanelErrorFallback, RootErrorFallback } from './ErrorFallback';

vi.mock('@/features/logger', () => ({ default: { error: vi.fn() } }));
vi.mock('@/utils/env', () => ({ isDev: vi.fn(() => true) }));

beforeEach(() => {
  vi.mocked(isDev).mockReturnValue(true);
  let sequence = 0;
  vi.spyOn(crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
    if (array) {
      new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(++sequence);
    }

    return array;
  });
});

afterEach(() => vi.restoreAllMocks());

describe('error occurrence reports', () => {
  it.each([
    { name: 'full page', Component: FullPageErrorFallback },
    { name: 'panel', Component: PanelErrorFallback },
  ])('keeps the $name report stable while copying and inspecting a non-Error failure', async ({ Component }) => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    render(<Component error="Thrown string" resetErrorBoundary={vi.fn()} boundary="Fixture" />);
    const copy = screen.getByRole('button', { name: 'Copy Error' });
    await user.click(copy);
    const firstReport = writeText.mock.calls[0][0];
    await user.click(screen.getByRole('button', { name: 'Stack Trace' }));
    await user.click(copy);
    expect(writeText.mock.calls[1][0]).toBe(firstReport);
  });

  it.each(['First failure', Number.NaN])('owns the root reference for occurrence %s', (error) => {
    const view = render(<RootErrorFallback error={error} />, { wrapper: React.StrictMode });
    const reference = () => screen.getByRole('code').textContent;
    const firstReference = reference();
    view.rerender(<RootErrorFallback error={error} />);
    expect(reference()).toBe(firstReference);
    view.rerender(<RootErrorFallback error="Second failure" />);
    expect(reference()).not.toBe(firstReference);
  });

  it('recovers a non-Error failure through the real boundary reset', () => {
    let shouldFail = true;
    function Surface() {
      if (shouldFail) {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- Exercise the boundary's non-Error contract.
        throw 'plugin failed';
      }

      return <div>Plugin recovered</div>;
    }

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      render(<ErrorBoundary FallbackComponent={FullPageErrorFallback}><Surface /></ErrorBoundary>);
      expect(screen.getByText('plugin failed')).toBeInTheDocument();
      shouldFail = false;
      fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
      expect(screen.getByText('Plugin recovered')).toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('reveals and hides developer diagnostics on demand', async () => {
    const user = userEvent.setup();
    const error = new Error('Failure');
    error.stack = 'Private diagnostic trace';
    render(<FullPageErrorFallback error={error} resetErrorBoundary={vi.fn()} />);
    const toggle = screen.getByRole('button', { name: 'Stack Trace' });
    expect(screen.queryByText(error.stack)).not.toBeInTheDocument();
    await user.click(toggle);
    expect(screen.getByText(error.stack)).toBeInTheDocument();
    await user.click(toggle);
    expect(screen.queryByText(error.stack)).not.toBeInTheDocument();
  });

  it.each([
    { name: 'full page', Component: FullPageErrorFallback },
    { name: 'panel', Component: PanelErrorFallback },
    { name: 'root', Component: RootErrorFallback },
  ])('keeps diagnostics out of the production $name surface', ({ Component }) => {
    vi.mocked(isDev).mockReturnValue(false);
    const error = new Error('Failure');
    error.stack = 'Private diagnostic trace';
    render(<Component error={error} resetErrorBoundary={vi.fn()} />);
    expect(screen.queryByText(error.stack)).not.toBeInTheDocument();
  });
});
