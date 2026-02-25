import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ActionBar from './ActionBar';

describe('ActionBar', () => {
  beforeEach(() => {
    vi.mocked(navigator.clipboard.writeText).mockClear();
  });

  it('shows copy button when content provided', () => {
    render(<ActionBar content="some text" alwaysVisible />);
    expect(screen.getByLabelText('Copy')).toBeInTheDocument();
  });

  it('shows copy button when onCopy provided', () => {
    render(<ActionBar onCopy={vi.fn()} alwaysVisible />);
    expect(screen.getByLabelText('Copy')).toBeInTheDocument();
  });

  it('clicking copy writes to clipboard and calls onCopy', async () => {
    const onCopy = vi.fn();
    render(<ActionBar content="hello world" onCopy={onCopy} alwaysVisible />);
    fireEvent.click(screen.getByLabelText('Copy'));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello world');
    });
    expect(onCopy).toHaveBeenCalledOnce();
  });

  it('shows regenerate button only when onRegenerate provided', () => {
    const { rerender } = render(<ActionBar alwaysVisible />);
    expect(screen.queryByLabelText('Regenerate')).not.toBeInTheDocument();

    rerender(<ActionBar onRegenerate={vi.fn()} alwaysVisible />);
    expect(screen.getByLabelText('Regenerate')).toBeInTheDocument();
  });

  it('shows thumbs up button only when onThumbsUp provided', () => {
    const { rerender } = render(<ActionBar alwaysVisible />);
    expect(screen.queryByLabelText('Good response')).not.toBeInTheDocument();

    rerender(<ActionBar onThumbsUp={vi.fn()} alwaysVisible />);
    expect(screen.getByLabelText('Good response')).toBeInTheDocument();
  });

  it('shows thumbs down button only when onThumbsDown provided', () => {
    const { rerender } = render(<ActionBar alwaysVisible />);
    expect(screen.queryByLabelText('Poor response')).not.toBeInTheDocument();

    rerender(<ActionBar onThumbsDown={vi.fn()} alwaysVisible />);
    expect(screen.getByLabelText('Poor response')).toBeInTheDocument();
  });
});
