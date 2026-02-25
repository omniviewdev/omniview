import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AIDiffView from './AIDiffView';

describe('AIDiffView', () => {
  const before = 'line1\nline2\nline3';
  const after = 'line1\nline2-modified\nline3\nline4';

  beforeEach(() => {
    vi.mocked(navigator.clipboard.writeText).mockClear();
  });

  it('renders diff header with counts', () => {
    render(<AIDiffView before={before} after={after} />);
    // Should show add/remove counts
    expect(screen.getByText(/\+\d/)).toBeInTheDocument();
    expect(screen.getByText(/-\d/)).toBeInTheDocument();
  });

  it('renders unchanged lines', () => {
    render(<AIDiffView before={before} after={after} />);
    expect(screen.getByText('line1')).toBeInTheDocument();
  });

  it('shows language in header', () => {
    render(<AIDiffView before={before} after={after} language="yaml" />);
    expect(screen.getByText('diff (yaml)')).toBeInTheDocument();
  });

  it('shows custom title', () => {
    render(<AIDiffView before={before} after={after} title="deployment.yaml" />);
    expect(screen.getByText('deployment.yaml')).toBeInTheDocument();
  });

  it('copies result to clipboard', async () => {
    render(<AIDiffView before={before} after={after} />);
    fireEvent.click(screen.getByLabelText('Copy result'));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(after);
    });
  });

  it('shows Copied feedback after copy', async () => {
    render(<AIDiffView before={before} after={after} />);
    fireEvent.click(screen.getByLabelText('Copy result'));
    await waitFor(() => {
      expect(screen.getByLabelText('Copied')).toBeInTheDocument();
    });
  });

  it('shows Apply button when onApply provided', () => {
    render(<AIDiffView before={before} after={after} onApply={vi.fn()} />);
    expect(screen.getByText('Apply changes')).toBeInTheDocument();
  });

  it('calls onApply with after content', () => {
    const handleApply = vi.fn();
    render(<AIDiffView before={before} after={after} onApply={handleApply} />);
    fireEvent.click(screen.getByText('Apply changes'));
    expect(handleApply).toHaveBeenCalledWith(after);
  });

  it('hides Apply button when no onApply', () => {
    render(<AIDiffView before={before} after={after} />);
    expect(screen.queryByText('Apply changes')).not.toBeInTheDocument();
  });
});
