import React from 'react';
import { render, screen } from '@testing-library/react';
import { CssVarsProvider } from '@mui/joy/styles';

jest.mock('react-router-dom', () => ({ useRouteError: jest.fn() }));
jest.mock('@/features/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
jest.mock('@/utils/env', () => ({ isDev: jest.fn(() => true) }));
jest.mock('@/utils/errorId', () => ({ generateErrorId: jest.fn(() => 'ERR-test') }));

const reloadMock = jest.fn();
Object.defineProperty(window, 'location', {
  value: { ...window.location, reload: reloadMock },
  writable: true,
});

import { useRouteError } from 'react-router-dom';
import { RouterErrorBoundary } from './ErrorBoundary';

const mockUseRouteError = useRouteError as jest.Mock;
const mockLogError = jest.requireMock('@/features/logger').default.error as jest.Mock;
const mockIsDev = jest.requireMock('@/utils/env').isDev as jest.Mock;

function renderWithJoy(ui: React.ReactElement) {
  return render(<CssVarsProvider>{ui}</CssVarsProvider>);
}

describe('RouterErrorBoundary', () => {
  beforeEach(() => {
    mockLogError.mockClear();
    mockIsDev.mockReturnValue(true);
  });

  it('renders FullPageErrorFallback with error message when useRouteError returns Error', () => {
    mockUseRouteError.mockReturnValue(new Error('route broke'));
    renderWithJoy(<RouterErrorBoundary />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('route broke')).toBeInTheDocument();
  });

  it('wraps non-Error values in Error (string)', () => {
    mockUseRouteError.mockReturnValue('string error');
    renderWithJoy(<RouterErrorBoundary />);
    expect(screen.getByText('string error')).toBeInTheDocument();
  });

  it('wraps non-Error values in Error (object)', () => {
    mockUseRouteError.mockReturnValue({ status: 404 });
    renderWithJoy(<RouterErrorBoundary />);
    expect(screen.getByText('[object Object]')).toBeInTheDocument();
  });

  it('logs error on mount', () => {
    mockUseRouteError.mockReturnValue(new Error('logged'));
    renderWithJoy(<RouterErrorBoundary />);
    expect(mockLogError).toHaveBeenCalledTimes(1);
    expect(mockLogError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'logged' }),
      expect.objectContaining({ boundary: 'RouterErrorBoundary' }),
    );
  });

  it('shows boundary="Router" label in dev mode', () => {
    mockUseRouteError.mockReturnValue(new Error('fail'));
    renderWithJoy(<RouterErrorBoundary />);
    expect(screen.getByText('Caught by: Router')).toBeInTheDocument();
  });
});
