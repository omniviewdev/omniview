import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChatDrawer from './ChatDrawer';

describe('ChatDrawer', () => {
  it('renders children when open', () => {
    render(
      <ChatDrawer open onClose={vi.fn()}>
        <div>Drawer content</div>
      </ChatDrawer>,
    );
    expect(screen.getByText('Drawer content')).toBeInTheDocument();
  });

  it('children not visible when closed', () => {
    render(
      <ChatDrawer open={false} onClose={vi.fn()}>
        <div>Drawer content</div>
      </ChatDrawer>,
    );
    expect(screen.queryByText('Drawer content')).not.toBeInTheDocument();
  });
});
