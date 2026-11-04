import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@omniviewdev/runtime', () => ({ useSchemaFields: ({ path }: { path: unknown[] }) => ({
  result: { schemaState: 'available', truncated: false },
  fields: path.length === 0 ? [{ Segment: { Kind: 'field', Name: 'metadata' }, Types: ['object'], HasChildren: true, Presence: 'required' }] :
    path.length === 1 ? [{ Segment: { Kind: 'field', Name: 'labels' }, Types: ['object'], HasChildren: true, Presence: 'optional' }] :
      [{ Segment: { Kind: 'mapValue' }, Types: ['string'], HasChildren: false, Presence: 'optional' }],
}) }));
import SchemaFieldPicker, { schemaPointer } from './SchemaFieldPicker';
afterEach(cleanup);
describe('schema-backed resource projection selection', () => {
  it('encodes exact object label keys as RFC6901 without interpreting dots or slash as navigation', () => {
    const select = vi.fn();
    render(<SchemaFieldPicker context={{ pluginID: 'owner', connectionID: 'cluster', resourceType: 'pods' }} value="" onSelect={select} />);
    expect(screen.queryByRole('button', { name: /metadata · object/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Browse schema fields' }));
    fireEvent.click(screen.getByRole('button', { name: /metadata · object/ }));
    fireEvent.click(screen.getByRole('button', { name: /labels · object/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Exact map key' }), { target: { value: 'example.io/team~name' } });
    fireEvent.click(screen.getByRole('button', { name: /Map entry · string/ }));
    expect(select).toHaveBeenCalledWith('/metadata/labels/example.io~1team~0name');
    expect(schemaPointer(['metadata', 'labels', 'example.io/team~name'])).toBe('/metadata/labels/example.io~1team~0name');
    expect(screen.getByRole('button', { name: 'Browse schema fields' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('textbox', { name: 'Exact map key' })).toBeNull();
  });
  it('does not select an entire object as provider public data', () => {
    const select = vi.fn();
    render(<SchemaFieldPicker context={{ pluginID: 'owner', connectionID: 'cluster', resourceType: 'pods' }} value="" onSelect={select} />);
    fireEvent.click(screen.getByRole('button', { name: 'Browse schema fields' }));
    fireEvent.click(screen.getByRole('button', { name: /metadata · object/ }));
    expect(select).not.toHaveBeenCalled();
    expect(screen.getByText('Schema path: /metadata')).toBeVisible();
  });
});
