import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ChatHeader from './ChatHeader';

describe('ChatHeader', () => {
  it('renders model name', () => {
    render(<ChatHeader modelName="Claude 3.5 Sonnet" />);
    expect(screen.getByText('Claude 3.5 Sonnet')).toBeInTheDocument();
  });

  it('displays token count', () => {
    render(<ChatHeader tokenCount={1500} />);
    expect(screen.getByText(/1,500/)).toBeInTheDocument();
  });

  it('shows token count with max tokens', () => {
    render(<ChatHeader tokenCount={1500} maxTokens={4000} />);
    expect(screen.getByText('1,500 / 4,000 tokens')).toBeInTheDocument();
  });

  it('new conversation button calls handler', () => {
    const onNew = vi.fn();
    render(<ChatHeader onNewConversation={onNew} />);
    fireEvent.click(screen.getByLabelText('New conversation'));
    expect(onNew).toHaveBeenCalledOnce();
  });

  it('close button calls onClose', () => {
    const onClose = vi.fn();
    render(<ChatHeader onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
