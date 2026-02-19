import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { CssVarsProvider } from '@mui/joy/styles';

import {
  createErrorMeta,
  onBoundaryError,
  FullPageErrorFallback,
  PanelErrorFallback,
  InlineErrorFallback,
  RootErrorFallback,
} from './ErrorFallback';

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('@/features/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
jest.mock('@/utils/errorId', () => ({ generateErrorId: jest.fn(() => 'ERR-test') }));
jest.mock('@/utils/env', () => ({ isDev: jest.fn(() => true) }));

const mockIsDev = jest.requireMock('@/utils/env').isDev as jest.Mock;
const mockLogError = jest.requireMock('@/features/logger').default.error as jest.Mock;

// clipboard + reload mocks
const writeTextMock = jest.fn().mockResolvedValue(undefined);
Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

const reloadMock = jest.fn();
Object.defineProperty(window, 'location', {
  value: { ...window.location, reload: reloadMock },
  writable: true,
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function renderWithJoy(ui: React.ReactElement) {
  return render(<CssVarsProvider>{ui}</CssVarsProvider>);
}

function makeError(message = 'boom', name = 'TypeError') {
  const err = new Error(message);
  err.name = name;
  err.stack = `${name}: ${message}\n    at Object.<anonymous> (test.ts:1:1)`;
  return err;
}

// ─── createErrorMeta ─────────────────────────────────────────────────────────

describe('createErrorMeta', () => {
  it('returns errorId, timestamp, and boundary', () => {
    const meta = createErrorMeta('Router');
    expect(meta.errorId).toBe('ERR-test');
    expect(meta.timestamp).toBeTruthy();
    expect(meta.boundary).toBe('Router');
  });

  it('omits boundary when not provided', () => {
    const meta = createErrorMeta();
    expect(meta.errorId).toBe('ERR-test');
    expect(meta).not.toHaveProperty('boundary');
  });
});

// ─── onBoundaryError ─────────────────────────────────────────────────────────

describe('onBoundaryError', () => {
  beforeEach(() => mockLogError.mockClear());

  it('calls log.error with error and componentStack', () => {
    const err = makeError();
    onBoundaryError(err, { componentStack: '<App>' });
    expect(mockLogError).toHaveBeenCalledWith(err, expect.objectContaining({ componentStack: '<App>' }));
  });

  it('handles null componentStack', () => {
    const err = makeError();
    onBoundaryError(err, { componentStack: null });
    expect(mockLogError).toHaveBeenCalledWith(err, expect.objectContaining({ componentStack: 'unavailable' }));
  });
});

// ─── FullPageErrorFallback ───────────────────────────────────────────────────

describe('FullPageErrorFallback', () => {
  const resetMock = jest.fn();

  beforeEach(() => {
    resetMock.mockClear();
    writeTextMock.mockClear();
    reloadMock.mockClear();
  });

  describe('dev mode', () => {
    beforeEach(() => mockIsDev.mockReturnValue(true));

    it('renders error message and "Something went wrong"', () => {
      renderWithJoy(<FullPageErrorFallback error={makeError('bad thing')} resetErrorBoundary={resetMock} />);
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(screen.getByText('bad thing')).toBeInTheDocument();
    });

    it('renders error name badge', () => {
      renderWithJoy(<FullPageErrorFallback error={makeError('x', 'RangeError')} resetErrorBoundary={resetMock} />);
      expect(screen.getByText('RangeError')).toBeInTheDocument();
    });

    it('renders error ID chip', () => {
      renderWithJoy(<FullPageErrorFallback error={makeError()} resetErrorBoundary={resetMock} />);
      expect(screen.getByText('ERR-test')).toBeInTheDocument();
    });

    it('renders boundary label when provided', () => {
      renderWithJoy(<FullPageErrorFallback error={makeError()} resetErrorBoundary={resetMock} boundary="Router" />);
      expect(screen.getByText('Caught by: Router')).toBeInTheDocument();
    });

    it('"Stack Trace" toggle reveals/hides stack', () => {
      renderWithJoy(<FullPageErrorFallback error={makeError()} resetErrorBoundary={resetMock} />);
      const toggle = screen.getByText('Stack Trace');
      expect(screen.queryByText(/at Object/)).not.toBeInTheDocument();
      fireEvent.click(toggle);
      expect(screen.getByText(/at Object/)).toBeInTheDocument();
      fireEvent.click(toggle);
      expect(screen.queryByText(/at Object/)).not.toBeInTheDocument();
    });

    it('"Try Again" calls resetErrorBoundary', () => {
      renderWithJoy(<FullPageErrorFallback error={makeError()} resetErrorBoundary={resetMock} />);
      fireEvent.click(screen.getByText('Try Again'));
      expect(resetMock).toHaveBeenCalledTimes(1);
    });

    it('"Reload Application" calls window.location.reload', () => {
      renderWithJoy(<FullPageErrorFallback error={makeError()} resetErrorBoundary={resetMock} />);
      fireEvent.click(screen.getByText('Reload Application'));
      expect(reloadMock).toHaveBeenCalledTimes(1);
    });

    it('"Copy Error" writes to clipboard with errorId + stack', async () => {
      renderWithJoy(<FullPageErrorFallback error={makeError('boom')} resetErrorBoundary={resetMock} />);
      await act(async () => {
        fireEvent.click(screen.getByText('Copy Error'));
      });
      expect(writeTextMock).toHaveBeenCalledTimes(1);
      const clipText = writeTextMock.mock.calls[0][0] as string;
      expect(clipText).toContain('ERR-test');
      expect(clipText).toContain('boom');
      expect(clipText).toContain('at Object');
    });
  });

  describe('prod mode', () => {
    beforeEach(() => mockIsDev.mockReturnValue(false));

    it('does NOT render stack trace toggle', () => {
      renderWithJoy(<FullPageErrorFallback error={makeError()} resetErrorBoundary={resetMock} />);
      expect(screen.queryByText('Stack Trace')).not.toBeInTheDocument();
    });

    it('shows "An unexpected error occurred" prefix', () => {
      renderWithJoy(<FullPageErrorFallback error={makeError('bad')} resetErrorBoundary={resetMock} />);
      expect(screen.getByText(/An unexpected error occurred: bad/)).toBeInTheDocument();
    });

    it('does NOT show boundary label', () => {
      renderWithJoy(<FullPageErrorFallback error={makeError()} resetErrorBoundary={resetMock} boundary="Router" />);
      expect(screen.queryByText(/Caught by/)).not.toBeInTheDocument();
    });

    it('still shows error ID, error message, and all buttons', () => {
      renderWithJoy(<FullPageErrorFallback error={makeError('oops')} resetErrorBoundary={resetMock} />);
      expect(screen.getByText('ERR-test')).toBeInTheDocument();
      expect(screen.getByText(/oops/)).toBeInTheDocument();
      expect(screen.getByText('Try Again')).toBeInTheDocument();
      expect(screen.getByText('Reload Application')).toBeInTheDocument();
      expect(screen.getByText('Copy Error')).toBeInTheDocument();
    });

    it('"Copy Error" still includes full stack', async () => {
      renderWithJoy(<FullPageErrorFallback error={makeError('boom')} resetErrorBoundary={resetMock} />);
      await act(async () => {
        fireEvent.click(screen.getByText('Copy Error'));
      });
      const clipText = writeTextMock.mock.calls[0][0] as string;
      expect(clipText).toContain('at Object');
    });
  });
});

// ─── PanelErrorFallback ─────────────────────────────────────────────────────

describe('PanelErrorFallback', () => {
  const resetMock = jest.fn();
  beforeEach(() => resetMock.mockClear());

  describe('dev mode', () => {
    beforeEach(() => mockIsDev.mockReturnValue(true));

    it('renders "{label} crashed"', () => {
      renderWithJoy(<PanelErrorFallback error={makeError()} resetErrorBoundary={resetMock} label="Sidebar" />);
      expect(screen.getByText('Sidebar crashed')).toBeInTheDocument();
    });

    it('renders stack trace toggle', () => {
      renderWithJoy(<PanelErrorFallback error={makeError()} resetErrorBoundary={resetMock} />);
      expect(screen.getByText('Stack Trace')).toBeInTheDocument();
    });

    it('renders error ID', () => {
      renderWithJoy(<PanelErrorFallback error={makeError()} resetErrorBoundary={resetMock} />);
      expect(screen.getByText('ERR-test')).toBeInTheDocument();
    });

    it('"Retry" calls resetErrorBoundary', () => {
      renderWithJoy(<PanelErrorFallback error={makeError()} resetErrorBoundary={resetMock} />);
      fireEvent.click(screen.getByText('Retry'));
      expect(resetMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('prod mode', () => {
    beforeEach(() => mockIsDev.mockReturnValue(false));

    it('renders "{label} encountered an error"', () => {
      renderWithJoy(<PanelErrorFallback error={makeError()} resetErrorBoundary={resetMock} label="Sidebar" />);
      expect(screen.getByText('Sidebar encountered an error')).toBeInTheDocument();
    });

    it('does NOT render stack trace toggle', () => {
      renderWithJoy(<PanelErrorFallback error={makeError()} resetErrorBoundary={resetMock} />);
      expect(screen.queryByText('Stack Trace')).not.toBeInTheDocument();
    });
  });
});

// ─── InlineErrorFallback ────────────────────────────────────────────────────

describe('InlineErrorFallback', () => {
  const resetMock = jest.fn();
  beforeEach(() => resetMock.mockClear());

  it('renders "Failed to render {label}"', () => {
    renderWithJoy(<InlineErrorFallback error={makeError()} resetErrorBoundary={resetMock} label="Widget" />);
    expect(screen.getByText('Failed to render Widget')).toBeInTheDocument();
  });

  it('"Retry" chip calls resetErrorBoundary', () => {
    renderWithJoy(<InlineErrorFallback error={makeError()} resetErrorBoundary={resetMock} />);
    // MUI Joy Chip uses an absolutely-positioned <button> overlay for click handling
    fireEvent.click(screen.getByRole('button'));
    expect(resetMock).toHaveBeenCalledTimes(1);
  });
});

// ─── RootErrorFallback ──────────────────────────────────────────────────────

describe('RootErrorFallback', () => {
  beforeEach(() => reloadMock.mockClear());

  describe('dev mode', () => {
    beforeEach(() => mockIsDev.mockReturnValue(true));

    it('renders stack trace pre block', () => {
      const err = makeError('crash');
      render(<RootErrorFallback error={err} />);
      expect(screen.getByText(/at Object/)).toBeInTheDocument();
    });

    it('renders error ID', () => {
      render(<RootErrorFallback error={makeError()} />);
      expect(screen.getByText('ERR-test')).toBeInTheDocument();
    });

    it('"Reload" button calls window.location.reload', () => {
      render(<RootErrorFallback error={makeError()} />);
      fireEvent.click(screen.getByText('Reload Application'));
      expect(reloadMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('prod mode', () => {
    beforeEach(() => mockIsDev.mockReturnValue(false));

    it('does NOT render stack trace pre block', () => {
      const err = makeError('crash');
      render(<RootErrorFallback error={err} />);
      expect(screen.queryByText(/at Object/)).not.toBeInTheDocument();
    });

    it('still renders error ID and reload button', () => {
      render(<RootErrorFallback error={makeError()} />);
      expect(screen.getByText('ERR-test')).toBeInTheDocument();
      expect(screen.getByText('Reload Application')).toBeInTheDocument();
    });
  });
});
