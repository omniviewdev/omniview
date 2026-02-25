import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ToolCallList from './ToolCallList';

describe('ToolCallList', () => {
  it('renders one ToolCall per item', () => {
    render(
      <ToolCallList
        calls={[
          { name: 'search', status: 'success' },
          { name: 'read_file', status: 'running' },
        ]}
      />,
    );
    expect(screen.getByText('search')).toBeInTheDocument();
    expect(screen.getByText('read_file')).toBeInTheDocument();
  });

  it('returns null for empty array', () => {
    const { container } = render(<ToolCallList calls={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
