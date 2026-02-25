import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MCPServerConfig from './MCPServerConfig';

const servers = [
  {
    id: 's1',
    name: 'Local MCP',
    url: 'http://localhost:3000',
    status: 'connected' as const,
    capabilities: ['tools', 'resources'],
  },
  {
    id: 's2',
    name: 'Remote MCP',
    url: 'https://mcp.example.com',
    status: 'disconnected' as const,
  },
];

describe('MCPServerConfig', () => {
  it('shows "No MCP servers configured" when empty', () => {
    render(<MCPServerConfig servers={[]} onRemove={vi.fn()} />);
    expect(screen.getByText('No MCP servers configured')).toBeInTheDocument();
  });

  it('renders server names and URLs', () => {
    render(<MCPServerConfig servers={servers} onRemove={vi.fn()} />);
    expect(screen.getByText('Local MCP')).toBeInTheDocument();
    expect(screen.getByText('http://localhost:3000')).toBeInTheDocument();
    expect(screen.getByText('Remote MCP')).toBeInTheDocument();
    expect(screen.getByText('https://mcp.example.com')).toBeInTheDocument();
  });

  it('capabilities shown as chips', () => {
    render(<MCPServerConfig servers={servers} onRemove={vi.fn()} />);
    expect(screen.getByText('tools')).toBeInTheDocument();
    expect(screen.getByText('resources')).toBeInTheDocument();
  });

  it('Add Server button calls onAdd', () => {
    const onAdd = vi.fn();
    render(<MCPServerConfig servers={servers} onAdd={onAdd} onRemove={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Add Server/ }));
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it('delete button calls onRemove with server id', () => {
    const onRemove = vi.fn();
    render(<MCPServerConfig servers={servers} onRemove={onRemove} />);
    const deleteIcons = screen.getAllByTestId('DeleteOutlineIcon');
    fireEvent.click(deleteIcons[0].closest('button')!);
    expect(onRemove).toHaveBeenCalledWith('s1');
  });

  it('no Add Server button when onAdd not provided', () => {
    render(<MCPServerConfig servers={servers} onRemove={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Add Server/ })).not.toBeInTheDocument();
  });
});
