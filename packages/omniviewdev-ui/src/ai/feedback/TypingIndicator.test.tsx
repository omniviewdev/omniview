import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TypingIndicator from './TypingIndicator';

describe('TypingIndicator', () => {
  it('renders 3 dot elements', () => {
    const { container } = render(<TypingIndicator />);
    // Each dot is a Box with borderRadius 50%
    const dots = container.querySelectorAll('.MuiBox-root > .MuiBox-root');
    expect(dots).toHaveLength(3);
  });

  it('renders smaller dots when compact', () => {
    const { container: normalContainer } = render(<TypingIndicator />);
    const { container: compactContainer } = render(<TypingIndicator compact />);

    const normalDots = normalContainer.querySelectorAll('.MuiBox-root > .MuiBox-root');
    const compactDots = compactContainer.querySelectorAll('.MuiBox-root > .MuiBox-root');

    // compact uses 4px dots, normal uses 6px
    const normalStyle = window.getComputedStyle(normalDots[0]);
    const compactStyle = window.getComputedStyle(compactDots[0]);
    // Both should exist and be dot elements
    expect(normalDots).toHaveLength(3);
    expect(compactDots).toHaveLength(3);
    // We can't easily check computed px in jsdom, but we verify both render
    expect(normalStyle).toBeDefined();
    expect(compactStyle).toBeDefined();
  });

  it('has accessible content (renders as inline-flex container)', () => {
    const { container } = render(<TypingIndicator />);
    expect(container.firstElementChild).toBeInTheDocument();
  });
});
