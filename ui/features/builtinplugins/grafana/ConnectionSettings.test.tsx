import { act, cleanup, fireEvent, render as renderUI, screen, type RenderResult } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ConnectionSettingsContext, MetricDataSource, MetricDefinition } from '@omniviewdev/runtime';
import GrafanaConnectionSettings from './ConnectionSettings';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

let queryClient: QueryClient;
function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient = client;
  client.setQueryData(['metric', 'bindings', 'inventory', 'tenant'], [{ public_scope: { region: 'old' } }]);
  client.setQueryData(['metric', 'source-inventory'], { options: [{ label: 'Old connection name' }] });
  return renderUI(ui, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}

const connectionContext: ConnectionSettingsContext = {
  resourcePluginID: 'inventory',
  connectionID: 'tenant',
  resourceTypes: ['inventory:/machines'],
  signal: 'metrics',
  catalogRevision: 'r1',
  publicMetadata: {},
};
const api = vi.hoisted(() => ({ sources: vi.fn(), owner: vi.fn(), save: vi.fn() }));
vi.mock('@omniviewdev/runtime', () => ({ navigateActivePage: vi.fn() }));
vi.mock('@omniviewdev/runtime/api', () => ({ MetricClient: {
  GetProviderConnections: async () => [{ id: 'first', name: 'First' }, { id: 'second', name: 'Second' }],
  GetMetricOwnerCatalog: async (...args: unknown[]) => api.owner(...args) ?? { definitions: [], scope_fields: [] },
  GetMetricBindings: async () => [],
  GetMetricSourceDefaults: async () => ({ source: { plugin_id: 'grafana', connection_id: 'first', datasource_uid: '', datasource_kind: '' } }),
  GetDataSources: api.sources,
  SaveMetricBinding: api.save,
} }));
vi.mock('./Mappings', () => ({
  MappingEditor: ({ definition, onSave }: { definition: MetricDefinition; onSave: (value: MetricDefinition) => Promise<void> }) =>
    <button onClick={async () => {
      await onSave({ ...definition, query: `${definition.query} + 1` });
    }}>Stage {definition.name}</button>,
  QueryPreview: ({ query }: { query: string }) => <pre>{query}</pre>,
}));
vi.mock('./SampleResource', () => ({ default: () => null }));
vi.mock('./DatasourceSelector', () => ({
  MetricsSelect: ({ label, value, options, onChange }: {
    label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void;
  }) => <select aria-label={label} value={value} onChange={event => {
    onChange(event.target.value); 
  }}>
    {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>,
  default: ({ sources, catalogError, onChange }: { sources: MetricDataSource[]; catalogError: string; onChange: (value: string) => void }) => <div>
    {sources.map(source => <span key={source.uid}>{source.uid}</span>)}
    <button onClick={() => {
      onChange('prom');
    }}>Select test datasource</button>
    {catalogError && <p role="alert">{catalogError}</p>}
  </div>,
}));
afterEach(() => {
  cleanup(); vi.resetAllMocks(); 
});

it('drops prior connection sources immediately and ignores their late response', async () => {
  const first = Promise.withResolvers<MetricDataSource[]>();
  api.sources.mockImplementation(async (_provider: string, connection: string) => connection === 'first'
    ? first.promise
    : Promise.resolve([{ uid: 'second-source', name: 'Second source', kind: 'prometheus' }]));
  await act(async () => {
    render(<GrafanaConnectionSettings {...connectionContext} />);
  });
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Provider connection'), { target: { value: 'second' } });
  });
  expect(screen.getByText('second-source')).toBeInTheDocument();
  await act(async () => {
    first.resolve([{ uid: 'first-source', name: 'First source', kind: 'prometheus' }]); 
  });
  expect(screen.queryByText('first-source')).toBeNull();
  fireEvent.change(screen.getByLabelText('Provider connection'), { target: { value: '' } });
  expect(screen.queryByText('second-source')).toBeNull();
});

it('reports a null datasource response as a catalog failure', async () => {
  api.sources.mockResolvedValue(null);
  await act(async () => {
    render(<GrafanaConnectionSettings {...connectionContext} />);
  });
  expect(screen.getByRole('alert')).toHaveTextContent('No datasource catalog returned.');
});

it('uses only owner-declared non-K scope fields and preserves their values', async () => {
  api.sources.mockResolvedValue([]);
  api.owner.mockReturnValue({ definitions: [], scope_fields: [
    { key: 'region', name: 'Region', description: 'Public region' },
    { key: 'account', name: 'Account', description: 'Public account' },
  ] });
  await act(async () => {
    render(<GrafanaConnectionSettings {...connectionContext} />);
  });
  expect(api.owner).toHaveBeenCalledWith('inventory', 'tenant');
  fireEvent.change(screen.getByLabelText('Region'), { target: { value: 'west' } });
  fireEvent.change(screen.getByLabelText('Account'), { target: { value: 'shared' } });
  expect(screen.getByLabelText('Region')).toHaveValue('west');
  expect(screen.getByLabelText('Account')).toHaveValue('shared');
  expect(screen.queryByLabelText(/cluster/i)).toBeNull();
  expect(screen.queryByLabelText(/secret/i)).toBeNull();
  api.save.mockImplementation(async value => value);
  fireEvent.click(screen.getByText('Select test datasource'));
  await act(async () => {
    fireEvent.click(screen.getByText('Save connection metrics'));
  });
  expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ public_scope: { region: 'west', account: 'shared' } }));
  expect(queryClient.getQueryState(['metric', 'bindings', 'inventory', 'tenant'])?.isInvalidated).toBe(true);
  expect(queryClient.getQueryState(['metric', 'source-inventory'])?.isInvalidated).toBe(true);
});

it('saves an owner with no scope requirements without inventing metadata', async () => {
  api.sources.mockResolvedValue([]);
  api.save.mockImplementation(async value => value);
  await act(async () => {
    render(<GrafanaConnectionSettings {...connectionContext} />);
  });
  fireEvent.click(screen.getByText('Select test datasource'));
  expect(screen.getByText('Save connection metrics')).not.toBeDisabled();
  await act(async () => {
    fireEvent.click(screen.getByText('Save connection metrics'));
  });
  expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ public_scope: {} }));
});

it('inherits effective global overrides and custom metrics and saves only connection differences', async () => {
  const global: MetricDefinition = {
    id: 'cpu', name: 'Global CPU', resource_keys: ['inventory:/machines'], unit: 'cores', semantics: 'gauge',
    supported_shapes: ['current', 'range'], query_language: 'promql', query: 'global_cpu',
    field_bindings: [], identity_labels: ['machine'], dimensions: [], reducer: 'none',
    batch_strategy: 'identity', revision: 'global-revision', native: true,
  };
  api.owner.mockReturnValue({ definitions: [global, { ...global, id: 'custom', name: 'Custom metric', query: 'custom_query', native: false }], scope_fields: [] });
  api.sources.mockResolvedValue([]);
  api.save.mockImplementation(async value => value);
  await act(async () => {
    render(<GrafanaConnectionSettings {...connectionContext} />);
  });
  expect(screen.getByText('global_cpu')).toBeInTheDocument();
  expect(screen.getByText('custom_query')).toBeInTheDocument();
  expect(screen.getByLabelText('Source policy')).toHaveValue('replace');
  expect(screen.queryByRole('option', { name: 'Supplement native metrics' })).toBeNull();
  await act(async () => {
    fireEvent.click(screen.getByText('Stage Global CPU'));
  });
  fireEvent.click(screen.getByText('Select test datasource'));
  await act(async () => {
    fireEvent.click(screen.getByText('Save connection metrics'));
  });
  expect(api.save).toHaveBeenCalledWith(expect.objectContaining({
    policy: 'replace',
    overrides: [{ metric_id: 'cpu', revision: 'global-revision', query: 'global_cpu + 1' }],
  }));
});

it('remounts owner drafts immediately and ignores late owner catalog responses', async () => {
  const previous = Promise.withResolvers<{ definitions: MetricDefinition[]; scope_fields: Array<{ key: string; name: string }> }>();
  api.owner.mockImplementation(async (_plugin: string, connection: string) => connection === 'tenant'
    ? previous.promise
    : { definitions: [], scope_fields: [{ key: 'region', name: 'New region' }] });
  api.sources.mockResolvedValue([]);
  const view = render(<GrafanaConnectionSettings {...connectionContext} />);
  await act(async () => {
    view.rerender(<GrafanaConnectionSettings {...connectionContext} connectionID="other" />);
  });
  fireEvent.change(screen.getByLabelText('New region'), { target: { value: 'west' } });
  await act(async () => {
    previous.resolve({ definitions: [], scope_fields: [{ key: 'old', name: 'Old region' }] });
  });
  expect(screen.queryByLabelText('Old region')).toBeNull();
  expect(screen.getByLabelText('New region')).toHaveValue('west');
});

it('drops loaded unsaved scope and provider drafts when owner changes', async () => {
  api.owner.mockReturnValue({ definitions: [], scope_fields: [{ key: 'region', name: 'Region' }] });
  api.sources.mockResolvedValue([]);
  const next = Promise.withResolvers<{ definitions: MetricDefinition[]; scope_fields: Array<{ key: string; name: string }> }>();
  let view!: RenderResult;
  await act(async () => {
    view = render(<GrafanaConnectionSettings {...connectionContext} />);
  });
  fireEvent.change(screen.getByLabelText('Region'), { target: { value: 'old-draft' } });
  fireEvent.change(screen.getByLabelText('Provider connection'), { target: { value: 'second' } });
  api.owner.mockReturnValue(next.promise);
  await act(async () => {
    view.rerender(<GrafanaConnectionSettings {...connectionContext} resourcePluginID="another-owner" />);
  });
  expect(screen.queryByLabelText('Region')).toBeNull();
  expect(screen.getByText('Loading external metric settings…')).toBeInTheDocument();
  await act(async () => {
    next.resolve({ definitions: [], scope_fields: [{ key: 'region', name: 'Region' }] });
  });
  expect(screen.getByLabelText('Region')).toHaveValue('');
  expect(screen.getByLabelText('Provider connection')).toHaveValue('first');
});
