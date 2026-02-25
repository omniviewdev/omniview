import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChatConversation from './ChatConversation';

describe('ChatConversation', () => {
  it('renders both message list and input', () => {
    render(
      <ChatConversation
        messages={[
          { id: '1', role: 'user', content: 'Hello', timestamp: '10:00' },
        ]}
        inputValue=""
        onInputChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Type a message...')).toBeInTheDocument();
  });

  it('header slot rendered when passed', () => {
    render(
      <ChatConversation
        messages={[]}
        inputValue=""
        onInputChange={vi.fn()}
        onSubmit={vi.fn()}
        header={<div data-testid="custom-header">Header</div>}
      />,
    );
    expect(screen.getByTestId('custom-header')).toBeInTheDocument();
  });
});
