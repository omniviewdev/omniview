import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import StreamingText from './StreamingText';

describe('StreamingText', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initially renders empty text', () => {
    const { container } = render(<StreamingText text="Hello world" />);
    // At charIndex=0, no text should be visible yet
    expect(container.textContent).toBe('');
  });

  it('reveals text progressively after rAF ticks', async () => {
    const fullText = 'Hello world';
    const { container } = render(<StreamingText text={fullText} speed={2} />);

    // After several ticks, some text should appear
    await act(async () => {
      vi.advanceTimersByTime(16);
    });

    const revealed = container.textContent ?? '';
    expect(revealed.length).toBeGreaterThan(0);
    // The revealed text should be a prefix of the full text
    expect(fullText.startsWith(revealed)).toBe(true);
  });

  it('eventually reveals full text', async () => {
    const fullText = 'Hi';
    const { container } = render(<StreamingText text={fullText} speed={10} />);

    // Advance many ticks to ensure completion regardless of chunk variance
    await act(async () => {
      vi.advanceTimersByTime(16 * 20);
    });

    expect(container.textContent).toContain('Hi');
  });

  it('calls onComplete when text fully revealed', async () => {
    const onComplete = vi.fn();
    render(<StreamingText text="AB" speed={10} onComplete={onComplete} />);

    // Advance enough ticks
    await act(async () => {
      vi.advanceTimersByTime(16 * 20);
    });

    expect(onComplete).toHaveBeenCalled();
  });

  it('cursor hidden when showCursor=false', () => {
    render(<StreamingText text="Hello" showCursor={false} />);
    expect(screen.queryByTestId('streaming-cursor')).not.toBeInTheDocument();
  });

  it('cursor visible while streaming', async () => {
    render(<StreamingText text="Hello world this is a long sentence" speed={1} />);

    await act(async () => {
      vi.advanceTimersByTime(16);
    });

    expect(screen.getByTestId('streaming-cursor')).toBeInTheDocument();
  });

  it('cursor disappears when streaming completes', async () => {
    render(<StreamingText text="AB" speed={10} />);

    await act(async () => {
      vi.advanceTimersByTime(16 * 20);
    });

    expect(screen.queryByTestId('streaming-cursor')).not.toBeInTheDocument();
  });
});
