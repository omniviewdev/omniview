import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChatMessageList from './ChatMessageList';
import type { ChatMessage } from './ChatMessageList';

const messages: ChatMessage[] = [
  { id: '1', role: 'user', content: 'Hello', timestamp: '10:00' },
  { id: '2', role: 'assistant', content: 'Hi there', timestamp: '10:01' },
  { id: '3', role: 'system', content: 'System note', timestamp: '10:02' },
];

describe('ChatMessageList', () => {
  it('renders all messages', () => {
    render(<ChatMessageList messages={messages} />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hi there')).toBeInTheDocument();
    expect(screen.getByText('System note')).toBeInTheDocument();
  });

  it('empty messages array renders empty container', () => {
    const { container } = render(<ChatMessageList messages={[]} />);
    // Container exists but no message boxes inside
    expect(container.firstElementChild).toBeInTheDocument();
    expect(screen.queryByText(/./)).toBeNull();
  });
});
