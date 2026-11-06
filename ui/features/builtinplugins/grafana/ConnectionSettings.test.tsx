import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ConnectionSettingsContext, MetricDataSource } from '@omniviewdev/runtime';
import GrafanaConnectionSettings from './ConnectionSettings';

const connectionContext: ConnectionSettingsContext = {
  resourcePluginID: 'kubernetes',
  connectionID: 'cluster',
  resourceTypes: [],
  signal: 'metrics',
  catalogRevision: 'r1',
  publicMetadata: {},
};
const api = vi.hoisted(() => ({ sources: vi.fn() }));
vi.mock('@omniviewdev/runtime', () => ({ navigateActivePage: vi.fn() }));
vi.mock('@omniviewdev/runtime/api', () => ({ MetricClient: {
  GetProviderConnections: async () => [{ id: 'first', name: 'First' }, { id: 'second', name: 'Second' }],
  GetMetricDefinitions: async () => [],
  GetMetricBindings: async () => [],
  GetMetricSourceDefaults: async () => ({ source: { plugin_id: 'grafana', connection_id: 'first', datasource_uid: '', datasource_kind: '' } }),
  GetDataSources: api.sources,
} }));
vi.mock('./Mappings', () => ({ MappingEditor: () => null, QueryPreview: () => null }));
vi.mock('./SampleResource', () => ({ default: () => null }));
vi.mock('./DatasourceSelector', () => ({
  MetricsSelect: ({ label, value, options, onChange }: {
    label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void;
  }) => <select aria-label={label} value={value} onChange={event => {
    onChange(event.target.value); 
  }}>
    {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>,
  default: ({ sources, catalogError }: { sources: MetricDataSource[]; catalogError: string }) => <div>
    {sources.map(source => <span key={source.uid}>{source.uid}</span>)}
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
