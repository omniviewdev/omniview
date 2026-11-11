import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import SchemaFieldPicker from './SchemaFieldPicker';

const state = vi.hoisted(() => ({ conditional: false, truncated: false }));
vi.mock('@omniviewdev/runtime', () => ({
  useResourceType: () => ({ resourceType: { data: { defaultRepresentation: 'native', representations: [{ id: 'native', revision: 'format-1' }] } } }),
  useResourceTypes: () => ({ resourceTypes: { data: [{ type: 'native/machines', defaultRepresentation: 'native', representations: [{ id: 'native', revision: 'format-1' }] }] } }),
  useSchemaFields: () => ({
    fields: [{ Segment: { Kind: 'field', Name: 'zone' }, Types: ['string'], Presence: 'optional', HasChildren: false,
      Applicability: state.conditional ? 'conditional' : 'unconditional', Conditions: state.conditional ? [{ Pointer: '#/oneOf', Branch: 0, Combinator: 'oneOf' }] : [] }],
    result: { schemaState: 'available', truncated: state.truncated }, error: null,
  }),
}));
vi.mock('@omniviewdev/base-ui', () => ({
  Stack: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  Text: ({ children, role }: React.PropsWithChildren<{ role?: string }>) => <span role={role}>{children}</span>,
  Button: ({ children, onClick, disabled, 'aria-label': label }: React.PropsWithChildren<{ onClick?: () => void; disabled?: boolean; 'aria-label'?: string }>) => <button onClick={onClick} disabled={disabled} aria-label={label}>{children}</button>,
  Input: { Root: ({ children }: React.PropsWithChildren) => <div>{children}</div>, Control: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} /> },
}));

beforeEach(() => { state.conditional = false; state.truncated = false; });
const context = { pluginID: 'provider', connectionID: 'fixture', resourceType: 'native/machines' };

it('selects a proven unconditional scalar', () => {
  const select = vi.fn();
  render(<SchemaFieldPicker context={context} value="" onSelect={select} />);
  fireEvent.click(screen.getByRole('button', { name: 'Browse schema fields' }));
  fireEvent.click(screen.getByRole('button', { name: /zone/ }));
  expect(select).toHaveBeenCalledWith('/zone');
});

it.each(['conditional', 'truncated'] as const)('does not authorize scalar selection from %s evidence', (kind) => {
  state[kind] = true;
  const select = vi.fn();
  render(<SchemaFieldPicker context={context} value="" onSelect={select} />);
  fireEvent.click(screen.getByRole('button', { name: 'Browse schema fields' }));
  fireEvent.click(screen.getByRole('button', { name: /zone/ }));
  expect(select).not.toHaveBeenCalled();
});
