import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AILoader from './AILoader';

describe('AILoader', () => {
  it('renders default label "Processing..."', () => {
    render(<AILoader />);
    expect(screen.getByText('Processing...')).toBeInTheDocument();
  });

  it('renders custom label', () => {
    render(<AILoader label="Loading data..." />);
    expect(screen.getByText('Loading data...')).toBeInTheDocument();
  });

  it('renders a spinner', () => {
    render(<AILoader />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });
});
