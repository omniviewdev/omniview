import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ connections: vi.fn(), definitions: vi.fn(), sources: vi.fn() }));
vi.mock('@omniviewdev/runtime/api', () => ({ MetricClient: { GetProviderConnections: api.connections, GetMetricDefinitions: api.definitions, GetDataSources: api.sources } }));
vi.mock('./ValidationContext', () => ({ default: () => null }));
vi.mock('./Mappings', () => ({ Mappings: () => null }));
import Settings from './Settings';
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe('global mapping datasource context', () => {
  it('allows manual UID after denied discovery and clears UID across provider instances', async () => {
    api.connections.mockResolvedValue([{ id: 'one', name: 'One', url: 'https://one.test' }, { id: 'two', name: 'Two', url: 'https://two.test' }]);
    api.definitions.mockResolvedValue([]);
    api.sources.mockRejectedValue(new Error('403 list denied'));
    render(<Settings />);
    fireEvent.click(screen.getByRole('tab', { name: 'Global mappings' }));
    await waitFor(() => expect(screen.getByRole('option', { name: 'One' })).toBeInTheDocument());
    fireEvent.change(screen.getByRole('combobox', { name: 'Provider connection' }), { target: { value: 'one' } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('403 list denied'));
    const manual = screen.getByRole('textbox', { name: 'Prometheus datasource UID' });
    fireEvent.change(manual, { target: { value: 'manual-prom' } });
    expect(manual).toHaveValue('manual-prom');
    expect(screen.getByRole('alert')).toHaveTextContent('403 list denied');
    fireEvent.change(screen.getByRole('combobox', { name: 'Provider connection' }), { target: { value: 'two' } });
    expect(manual).toHaveValue('');
    await waitFor(() => expect(api.sources).toHaveBeenCalledWith('grafana', 'two'));
  });
});
