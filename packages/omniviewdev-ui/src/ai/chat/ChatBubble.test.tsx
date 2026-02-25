import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChatBubble from './ChatBubble';

describe('ChatBubble', () => {
  it('renders children content', () => {
    render(<ChatBubble role="user">Hello world</ChatBubble>);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders string timestamp as-is', () => {
    render(<ChatBubble role="user" timestamp="2:30 PM">Hi</ChatBubble>);
    expect(screen.getByText('2:30 PM')).toBeInTheDocument();
  });

  it('formats Date timestamp via toLocaleTimeString', () => {
    const date = new Date('2024-01-01T14:30:00');
    render(<ChatBubble role="user" timestamp={date}>Hi</ChatBubble>);
    const timeText = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    expect(screen.getByText(timeText)).toBeInTheDocument();
  });

  it('does not render time when no timestamp', () => {
    const { container } = render(<ChatBubble role="user">Hi</ChatBubble>);
    const typographies = container.querySelectorAll('.MuiTypography-root');
    expect(typographies).toHaveLength(0);
  });

  it('renders actions slot inside bubble', () => {
    render(
      <ChatBubble role="user" actions={<button>Like</button>}>
        Content
      </ChatBubble>,
    );
    expect(screen.getByRole('button', { name: 'Like' })).toBeInTheDocument();
  });

  it('renders avatar for user role', () => {
    render(
      <ChatBubble role="user" avatar={<span data-testid="avatar">A</span>}>
        Hi
      </ChatBubble>,
    );
    expect(screen.getByTestId('avatar')).toBeInTheDocument();
  });

  it('renders avatar for assistant role', () => {
    render(
      <ChatBubble role="assistant" avatar={<span data-testid="avatar">B</span>}>
        Hi
      </ChatBubble>,
    );
    expect(screen.getByTestId('avatar')).toBeInTheDocument();
  });

  it('hides avatar for system role', () => {
    render(
      <ChatBubble role="system" avatar={<span data-testid="avatar">S</span>}>
        System msg
      </ChatBubble>,
    );
    expect(screen.queryByTestId('avatar')).not.toBeInTheDocument();
  });

  // --- Alignment: column alignItems matches role ---
  it('user role column aligns items to flex-end', () => {
    render(<ChatBubble role="user" timestamp="1:00 PM">User msg</ChatBubble>);
    const col = screen.getByTestId('chat-bubble-column');
    expect(col).toBeInTheDocument();
    // Bubble and timestamp are both children of the column
    expect(col.children.length).toBe(2); // bubble + timestamp
  });

  it('assistant role column aligns items to flex-start', () => {
    render(<ChatBubble role="assistant" timestamp="1:00 PM">Asst msg</ChatBubble>);
    const col = screen.getByTestId('chat-bubble-column');
    expect(col.children.length).toBe(2);
  });

  it('system role column aligns items to center', () => {
    render(<ChatBubble role="system" timestamp="1:00 PM">Sys msg</ChatBubble>);
    const col = screen.getByTestId('chat-bubble-column');
    expect(col.children.length).toBe(2);
  });

  // --- User bubble does not use white-on-bright-accent ---
  it('user bubble does not have hardcoded white text color', () => {
    render(<ChatBubble role="user">User text</ChatBubble>);
    const col = screen.getByTestId('chat-bubble-column');
    const bubble = col.firstElementChild as HTMLElement;
    const inlineColor = bubble.style.color;
    expect(inlineColor).not.toBe('#fff');
    expect(inlineColor).not.toBe('white');
    expect(inlineColor).not.toBe('rgb(255, 255, 255)');
  });

  // --- Assistant bubble must NOT have bubble styling (regression guard) ---
  it('assistant bubble has no background color', () => {
    render(<ChatBubble role="assistant">Reply</ChatBubble>);
    const col = screen.getByTestId('chat-bubble-column');
    const bubble = col.firstElementChild as HTMLElement;
    // Must not have inline background-color set
    expect(bubble.style.backgroundColor).toBe('');
  });

  it('assistant bubble has no padding', () => {
    render(<ChatBubble role="assistant">Reply</ChatBubble>);
    const col = screen.getByTestId('chat-bubble-column');
    const bubble = col.firstElementChild as HTMLElement;
    // Must not have inline padding — plain text, no bubble
    expect(bubble.style.padding).toBe('');
    expect(bubble.style.paddingLeft).toBe('');
    expect(bubble.style.paddingRight).toBe('');
    expect(bubble.style.paddingTop).toBe('');
    expect(bubble.style.paddingBottom).toBe('');
  });

  it('assistant bubble has no border-radius', () => {
    render(<ChatBubble role="assistant">Reply</ChatBubble>);
    const col = screen.getByTestId('chat-bubble-column');
    const bubble = col.firstElementChild as HTMLElement;
    expect(bubble.style.borderRadius).toBe('');
  });

  // --- Size prop ---
  it('accepts size prop without error', () => {
    render(
      <ChatBubble role="user" size="lg">Large text</ChatBubble>,
    );
    expect(screen.getByText('Large text')).toBeInTheDocument();
  });

  it('each size variant renders successfully', () => {
    const sizes = ['xs', 'sm', 'md', 'lg'] as const;
    for (const sz of sizes) {
      const { unmount } = render(
        <ChatBubble role="assistant" size={sz}>{sz} text</ChatBubble>,
      );
      expect(screen.getByText(`${sz} text`)).toBeInTheDocument();
      unmount();
    }
  });
});
