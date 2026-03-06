import React from 'react';
import { render, screen } from '@testing-library/react';
import logger from '@/features/logger';
import { isDev } from '@/utils/env';
vi.mock('react-router-dom', () => ({ useRouteError: vi.fn() }));
vi.mock('@/features/logger', () => ({ __esModule: true, default: { error: vi.fn() } }));
vi.mock('@/utils/env', () => ({ isDev: vi.fn(() => true) }));
vi.mock('@/utils/errorId', () => ({ generateErrorId: vi.fn(() => 'ERR-test') }));

const reloadMock = vi.fn();
Object.defineProperty(window, 'location', {
  value: { ...window.location, reload: reloadMock },
  writable: true,
});

import { useRouteError } from 'react-router-dom';
import { RouterErrorBoundary } from './ErrorBoundary';

const mockUseRouteError = vi.mocked(useRouteError);
const mockLogError = vi.mocked(logger.error);
const mockIsDev = vi.mocked(isDev);
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

describe('RouterErrorBoundary', () => {
  beforeEach(() => {
    mockLogError.mockClear();
    mockIsDev.mockReturnValue(true);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders FullPageErrorFallback with error message when useRouteError returns Error', () => {
    mockUseRouteError.mockReturnValue(new Error('route broke'));
    render(<RouterErrorBoundary />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('route broke')).toBeInTheDocument();
  });

  it('wraps non-Error values in Error (string)', () => {
    mockUseRouteError.mockReturnValue('string error');
    render(<RouterErrorBoundary />);
    expect(screen.getByText('string error')).toBeInTheDocument();
  });

  it('wraps non-Error values in Error (object)', () => {
    mockUseRouteError.mockReturnValue({ status: 404 });
    render(<RouterErrorBoundary />);
    expect(screen.getByText('[object Object]')).toBeInTheDocument();
  });

  it('logs error on mount', () => {
    mockUseRouteError.mockReturnValue(new Error('logged'));
    render(<RouterErrorBoundary />);
    expect(mockLogError).toHaveBeenCalledTimes(1);
    expect(mockLogError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'logged' }),
      expect.objectContaining({ boundary: 'RouterErrorBoundary' }),
    );
  });

  it('shows boundary="Router" label in dev mode', () => {
    mockUseRouteError.mockReturnValue(new Error('fail'));
    render(<RouterErrorBoundary />);
    expect(screen.getByText('Caught by: Router')).toBeInTheDocument();
  });
});
