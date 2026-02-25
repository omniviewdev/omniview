import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AIStructuredDataViewer from './AIStructuredDataViewer';

const yamlContent = `apiVersion: v1
kind: Pod
metadata:
  name: nginx`;

describe('AIStructuredDataViewer', () => {
  beforeEach(() => {
    vi.mocked(navigator.clipboard.writeText).mockClear();
  });

  it('renders content', () => {
    render(<AIStructuredDataViewer content={yamlContent} format="yaml" />);
    expect(screen.getByText(/apiVersion: v1/)).toBeInTheDocument();
  });

  it('shows format label in header', () => {
    render(<AIStructuredDataViewer content="data" format="json" />);
    expect(screen.getByText('json')).toBeInTheDocument();
  });

  it('shows custom title', () => {
    render(<AIStructuredDataViewer content="data" title="pod.yaml" />);
    expect(screen.getByText('pod.yaml')).toBeInTheDocument();
  });

  it('copies content to clipboard', async () => {
    render(<AIStructuredDataViewer content={yamlContent} />);
    fireEvent.click(screen.getByLabelText('Copy content'));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(yamlContent);
    });
  });

  it('shows Apply button when onApply provided', () => {
    render(<AIStructuredDataViewer content="data" onApply={vi.fn()} />);
    expect(screen.getByText('Apply')).toBeInTheDocument();
  });

  it('calls onApply with content', () => {
    const handleApply = vi.fn();
    render(<AIStructuredDataViewer content="data" onApply={handleApply} />);
    fireEvent.click(screen.getByText('Apply'));
    expect(handleApply).toHaveBeenCalledWith('data');
  });

  it('shows Edit button when onEdit provided', () => {
    render(<AIStructuredDataViewer content="data" onEdit={vi.fn()} />);
    expect(screen.getByText('Edit')).toBeInTheDocument();
  });

  it('collapses content when collapsible', () => {
    render(
      <AIStructuredDataViewer content={yamlContent} collapsible />,
    );
    // Content should be hidden (maxHeight: 0)
    // After clicking header, it should expand
    fireEvent.click(screen.getByText('text'));
    expect(screen.getByText(/apiVersion: v1/)).toBeInTheDocument();
  });
});
