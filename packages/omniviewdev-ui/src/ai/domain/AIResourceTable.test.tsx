import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AIResourceTable from './AIResourceTable';

const columns = [
  { key: 'name', label: 'Name' },
  { key: 'status', label: 'Status' },
  { key: 'age', label: 'Age' },
];

const rows = [
  { name: 'nginx-abc', status: 'Running', age: '5d' },
  { name: 'redis-xyz', status: 'Pending', age: '1h' },
];

describe('AIResourceTable', () => {
  it('renders column headers', () => {
    render(<AIResourceTable rows={rows} columns={columns} />);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Age')).toBeInTheDocument();
  });

  it('renders row data', () => {
    render(<AIResourceTable rows={rows} columns={columns} />);
    expect(screen.getByText('nginx-abc')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('redis-xyz')).toBeInTheDocument();
  });

  it('shows title when provided', () => {
    render(<AIResourceTable rows={rows} columns={columns} title="Pods" />);
    expect(screen.getByText('Pods')).toBeInTheDocument();
  });

  it('calls onRowClick when row is clicked', () => {
    const handleClick = vi.fn();
    render(
      <AIResourceTable
        rows={rows}
        columns={columns}
        onRowClick={handleClick}
      />,
    );
    fireEvent.click(screen.getByText('nginx-abc'));
    expect(handleClick).toHaveBeenCalledWith(rows[0]);
  });

  it('uses custom render function', () => {
    const customColumns = [
      {
        key: 'name',
        label: 'Name',
        render: (val: string) => `[${val}]`,
      },
    ];
    render(<AIResourceTable rows={rows} columns={customColumns} />);
    expect(screen.getByText('[nginx-abc]')).toBeInTheDocument();
  });
});
