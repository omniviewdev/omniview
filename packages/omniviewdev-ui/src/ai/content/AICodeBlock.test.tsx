import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AICodeBlock from './AICodeBlock';

describe('AICodeBlock', () => {
  beforeEach(() => {
    vi.mocked(navigator.clipboard.writeText).mockClear();
  });

  it('renders code content', () => {
    render(<AICodeBlock code="console.log('hello')" />);
    expect(screen.getByText("console.log('hello')")).toBeInTheDocument();
  });

  it('displays language label', () => {
    render(<AICodeBlock code="const x = 1" language="typescript" />);
    expect(screen.getByText('typescript')).toBeInTheDocument();
  });

  it('shows "code" as default language label', () => {
    render(<AICodeBlock code="x = 1" />);
    expect(screen.getByText('code')).toBeInTheDocument();
  });

  it('copy button copies code to clipboard', async () => {
    render(<AICodeBlock code="hello world" />);
    fireEvent.click(screen.getByLabelText('Copy code'));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello world');
    });
  });

  it('shows "Copied" feedback after copy', async () => {
    render(<AICodeBlock code="hello" />);
    fireEvent.click(screen.getByLabelText('Copy code'));
    await waitFor(() => {
      expect(screen.getByLabelText('Copied')).toBeInTheDocument();
    });
  });

  it('shows line numbers when showLineNumbers=true', () => {
    render(<AICodeBlock code={'line1\nline2\nline3'} showLineNumbers />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});
