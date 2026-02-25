import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ChatHistory from './ChatHistory';

const conversations = [
  {
    id: '1',
    title: 'K8s Deploy',
    lastMessage: 'Deploy completed',
    timestamp: new Date().toISOString(),
    messageCount: 5,
  },
  {
    id: '2',
    title: 'Debug Pods',
    lastMessage: 'Found the issue',
    timestamp: new Date().toISOString(),
    messageCount: 3,
  },
];

describe('ChatHistory', () => {
  it('renders all conversations', () => {
    render(<ChatHistory conversations={conversations} onSelect={vi.fn()} />);
    expect(screen.getByText('K8s Deploy')).toBeInTheDocument();
    expect(screen.getByText('Debug Pods')).toBeInTheDocument();
  });

  it('click conversation calls onSelect', () => {
    const onSelect = vi.fn();
    render(<ChatHistory conversations={conversations} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Debug Pods'));
    expect(onSelect).toHaveBeenCalledWith('2');
  });

  it('search filters by title', () => {
    render(<ChatHistory conversations={conversations} onSelect={vi.fn()} />);
    const searchInput = screen.getByPlaceholderText('Search conversations...');
    fireEvent.change(searchInput, { target: { value: 'Deploy' } });
    expect(screen.getByText('K8s Deploy')).toBeInTheDocument();
    expect(screen.queryByText('Debug Pods')).not.toBeInTheDocument();
  });

  it('delete button calls onDelete with correct id', () => {
    const onDelete = vi.fn();
    render(
      <ChatHistory
        conversations={conversations}
        onSelect={vi.fn()}
        onDelete={onDelete}
      />,
    );
    // Delete buttons are IconButtons with DeleteOutlineIcon
    const deleteIcons = screen.getAllByTestId('DeleteOutlineIcon');
    fireEvent.click(deleteIcons[0]);
    expect(onDelete).toHaveBeenCalledWith('1');
  });

  it('groups conversations by date labels', () => {
    render(<ChatHistory conversations={conversations} onSelect={vi.fn()} />);
    // Both conversations have today's date
    expect(screen.getByText('Today')).toBeInTheDocument();
  });
});
