import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AIInlineCitation from './AIInlineCitation';

describe('AIInlineCitation', () => {
  it('renders citation number', () => {
    render(<AIInlineCitation index={3} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('wraps in link when url provided', () => {
    render(<AIInlineCitation index={1} url="https://example.com" />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://example.com');
  });

  it('renders as span (no link) when no url', () => {
    render(<AIInlineCitation index={1} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders with tooltip when title provided', () => {
    render(<AIInlineCitation index={1} title="Source document" />);
    // The number should still be visible
    expect(screen.getByText('1')).toBeInTheDocument();
  });
});
