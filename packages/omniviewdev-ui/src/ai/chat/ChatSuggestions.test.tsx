import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ChatSuggestions from './ChatSuggestions';

describe('ChatSuggestions', () => {
  it('renders chips for each suggestion', () => {
    render(
      <ChatSuggestions
        suggestions={['Deploy', 'Scale', 'Monitor']}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('Deploy')).toBeInTheDocument();
    expect(screen.getByText('Scale')).toBeInTheDocument();
    expect(screen.getByText('Monitor')).toBeInTheDocument();
  });

  it('calls onSelect with correct suggestion text on click', () => {
    const onSelect = vi.fn();
    render(
      <ChatSuggestions suggestions={['Deploy', 'Scale']} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByText('Scale'));
    expect(onSelect).toHaveBeenCalledWith('Scale');
  });

  it('returns null when suggestions array is empty', () => {
    const { container } = render(
      <ChatSuggestions suggestions={[]} onSelect={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
