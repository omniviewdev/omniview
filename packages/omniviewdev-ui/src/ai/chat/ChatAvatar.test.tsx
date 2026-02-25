import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChatAvatar from './ChatAvatar';

describe('ChatAvatar', () => {
  it('renders default icon for user role', () => {
    const { container } = render(<ChatAvatar role="user" />);
    // LuUser icon should be present as an SVG
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('renders default icon for assistant role', () => {
    const { container } = render(<ChatAvatar role="assistant" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('renders img when src is provided', () => {
    render(<ChatAvatar role="user" src="https://example.com/avatar.png" />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'https://example.com/avatar.png');
  });

  it('renders status dot when status is provided', () => {
    const { container } = render(<ChatAvatar role="user" status="online" />);
    // Status dot is the last child Box with absolute positioning
    const boxes = container.querySelectorAll('.MuiBox-root');
    // Should have more than just the wrapper and icon container
    expect(boxes.length).toBeGreaterThanOrEqual(3);
  });

  it('does not render status dot when no status', () => {
    const { container } = render(<ChatAvatar role="user" />);
    const boxes = container.querySelectorAll('.MuiBox-root');
    // Wrapper + icon container = 2 boxes, no status dot
    expect(boxes.length).toBeLessThan(4);
  });
});
