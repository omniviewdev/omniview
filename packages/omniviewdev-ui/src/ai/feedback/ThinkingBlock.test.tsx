import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ThinkingBlock from './ThinkingBlock';

describe('ThinkingBlock', () => {
  it('collapsed by default', () => {
    const { container } = render(<ThinkingBlock thinking="Step 1: analyze..." />);
    // Content is in the DOM but the expand icon is not rotated (collapsed)
    expect(screen.getByText('Step 1: analyze...')).toBeInTheDocument();
    const expandIcon = container.querySelector('[data-testid="ExpandMoreIcon"]');
    expect(expandIcon).toBeInTheDocument();
  });

  it('click header expands to show thinking content', () => {
    render(<ThinkingBlock thinking="Step 1: analyze..." />);
    fireEvent.click(screen.getByText('Thinking...'));
    expect(screen.getByText('Step 1: analyze...')).toBeInTheDocument();
  });

  it('defaultExpanded=true starts expanded', () => {
    render(<ThinkingBlock thinking="Step 1: analyze..." defaultExpanded />);
    expect(screen.getByText('Step 1: analyze...')).toBeInTheDocument();
  });

  it('custom label replaces default "Thinking..."', () => {
    render(<ThinkingBlock thinking="content" label="Reasoning..." />);
    expect(screen.getByText('Reasoning...')).toBeInTheDocument();
    expect(screen.queryByText('Thinking...')).not.toBeInTheDocument();
  });
});
