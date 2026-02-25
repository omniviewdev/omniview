import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ChatInput from './ChatInput';

describe('ChatInput', () => {
  const defaultProps = {
    value: '',
    onChange: vi.fn(),
    onSubmit: vi.fn(),
  };

  it('renders textarea with placeholder', () => {
    render(<ChatInput {...defaultProps} placeholder="Ask something..." />);
    expect(screen.getByPlaceholderText('Ask something...')).toBeInTheDocument();
  });

  it('calls onChange on typing', () => {
    const onChange = vi.fn();
    render(<ChatInput {...defaultProps} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText('Type a message...'), {
      target: { value: 'hello' },
    });
    expect(onChange).toHaveBeenCalledWith('hello');
  });

  it('send button is disabled when value is empty', () => {
    render(<ChatInput {...defaultProps} />);
    expect(screen.getByLabelText('Send message')).toBeDisabled();
  });

  it('send button is disabled when disabled prop is true', () => {
    render(<ChatInput {...defaultProps} value="hi" disabled />);
    expect(screen.getByLabelText('Send message')).toBeDisabled();
  });

  it('send button is disabled when loading prop is true', () => {
    render(<ChatInput {...defaultProps} value="hi" loading />);
    expect(screen.getByLabelText('Send message')).toBeDisabled();
  });

  it('click send button calls onSubmit with trimmed value', () => {
    const onSubmit = vi.fn();
    render(<ChatInput {...defaultProps} value="  hello  " onSubmit={onSubmit} />);
    fireEvent.click(screen.getByLabelText('Send message'));
    expect(onSubmit).toHaveBeenCalledWith('hello');
  });

  it('Cmd+Enter calls onSubmit', () => {
    const onSubmit = vi.fn();
    render(<ChatInput {...defaultProps} value="hello" onSubmit={onSubmit} />);
    fireEvent.keyDown(screen.getByPlaceholderText('Type a message...'), {
      key: 'Enter',
      metaKey: true,
    });
    expect(onSubmit).toHaveBeenCalledWith('hello');
  });

  it('Ctrl+Enter calls onSubmit', () => {
    const onSubmit = vi.fn();
    render(<ChatInput {...defaultProps} value="hello" onSubmit={onSubmit} />);
    fireEvent.keyDown(screen.getByPlaceholderText('Type a message...'), {
      key: 'Enter',
      ctrlKey: true,
    });
    expect(onSubmit).toHaveBeenCalledWith('hello');
  });

  it('Cmd+Enter does not submit when disabled', () => {
    const onSubmit = vi.fn();
    render(<ChatInput {...defaultProps} value="hello" onSubmit={onSubmit} disabled />);
    fireEvent.keyDown(screen.getByPlaceholderText('Type a message...'), {
      key: 'Enter',
      metaKey: true,
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('maxLength shows character count', () => {
    render(<ChatInput {...defaultProps} value="hi" maxLength={100} />);
    expect(screen.getByText('2/100')).toBeInTheDocument();
  });

  it('renders actions slot', () => {
    render(
      <ChatInput {...defaultProps} actions={<button>Attach</button>} />,
    );
    expect(screen.getByRole('button', { name: 'Attach' })).toBeInTheDocument();
  });
});
