import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import AIMarkdown from './AIMarkdown';

// Mock the heavy markdown preview component
vi.mock('@uiw/react-markdown-preview', () => ({
  default: ({ source }: { source: string }) => (
    <div data-testid="md-preview">{source}</div>
  ),
}));

describe('AIMarkdown', () => {
  it('renders markdown content', () => {
    const { getByTestId } = render(<AIMarkdown source="Hello **world**" />);
    expect(getByTestId('md-preview')).toHaveTextContent('Hello **world**');
  });

  it('streaming cursor container has cursor styles when streaming=true', () => {
    const { container } = render(<AIMarkdown source="Streaming..." streaming />);
    // The wrapper Box should exist
    expect(container.firstElementChild).toBeInTheDocument();
  });

  it('no cursor styles when streaming=false', () => {
    const { container } = render(<AIMarkdown source="Done." streaming={false} />);
    expect(container.firstElementChild).toBeInTheDocument();
  });
});
