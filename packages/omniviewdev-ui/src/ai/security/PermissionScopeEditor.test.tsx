import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PermissionScopeEditor from './PermissionScopeEditor';

const scopes = [
  { resourceType: 'pods', actions: { read: true, write: false, delete: false } },
  { resourceType: 'deployments', actions: { read: true, write: true, delete: false } },
];

const actions = ['read', 'write', 'delete'];

describe('PermissionScopeEditor', () => {
  it('renders row per resource type', () => {
    render(
      <PermissionScopeEditor scopes={scopes} actions={actions} onChange={vi.fn()} />,
    );
    expect(screen.getByText('pods')).toBeInTheDocument();
    expect(screen.getByText('deployments')).toBeInTheDocument();
  });

  it('renders column per action', () => {
    render(
      <PermissionScopeEditor scopes={scopes} actions={actions} onChange={vi.fn()} />,
    );
    expect(screen.getByText('read')).toBeInTheDocument();
    expect(screen.getByText('write')).toBeInTheDocument();
    expect(screen.getByText('delete')).toBeInTheDocument();
  });

  it('checkbox reflects current scope value', () => {
    render(
      <PermissionScopeEditor scopes={scopes} actions={actions} onChange={vi.fn()} />,
    );
    const checkboxes = screen.getAllByRole('checkbox');
    // pods: read=true, write=false, delete=false
    // deployments: read=true, write=true, delete=false
    // Total 6 checkboxes
    expect(checkboxes).toHaveLength(6);
    expect(checkboxes[0]).toBeChecked(); // pods.read
    expect(checkboxes[1]).not.toBeChecked(); // pods.write
    expect(checkboxes[2]).not.toBeChecked(); // pods.delete
    expect(checkboxes[3]).toBeChecked(); // deployments.read
    expect(checkboxes[4]).toBeChecked(); // deployments.write
    expect(checkboxes[5]).not.toBeChecked(); // deployments.delete
  });

  it('toggle checkbox calls onChange with updated scopes', () => {
    const onChange = vi.fn();
    render(
      <PermissionScopeEditor scopes={scopes} actions={actions} onChange={onChange} />,
    );
    const checkboxes = screen.getAllByRole('checkbox');
    // Toggle pods.write (index 1) from false to true
    fireEvent.click(checkboxes[1]);
    expect(onChange).toHaveBeenCalledWith([
      { resourceType: 'pods', actions: { read: true, write: true, delete: false } },
      { resourceType: 'deployments', actions: { read: true, write: true, delete: false } },
    ]);
  });
});
