import { act, cleanup, fireEvent, render as renderUI, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { MetricDefinition } from '@omniviewdev/runtime';
import GrafanaSettings from './Settings';
import type { ValidationSample } from './ValidationContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderUI(ui, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}

const api = vi.hoisted(() => ({ owner: vi.fn(), saved: vi.fn(), save: vi.fn(), remove: vi.fn() }));
vi.mock('@omniviewdev/runtime/runtime', () => ({ Browser: {} }));
vi.mock('@omniviewdev/runtime/api', () => ({ MetricClient: {
  GetProviderConnections: async () => [{ id: 'monitor', name: 'Monitor' }],
  GetMetricDefinitions: api.saved,
  GetMetricOwnerCatalog: api.owner,
  GetMetricSourceDefaults: async () => ({ revision: 'source-1' }),
  GetDataSources: async () => [{ uid: 'prom', name: 'Prometheus', kind: 'prometheus' }],
  ValidateMetricDefinition: async () => ({ valid: true, issues: [] }),
  SaveMetricDefinition: api.save,
  DeleteMetricDefinition: api.remove,
} }));
// Resource discovery is a separate boundary. Exercise the real global editor and its catalog lifecycle here.
vi.mock('./ValidationContext', () => ({ default: ({ onChange, lockOwner }: {
  onChange: (sample: ValidationSample) => void; lockOwner: boolean;
}) => <button disabled={lockOwner} onClick={() => {
  onChange({ context: {
    pluginID: 'kubernetes', connectionID: 'cluster', resourceType: '',
  } }); 
}}>Select resource owner</button> }));
vi.mock('./DatasourceSelector', () => ({
  MetricsSelect: ({ label, value, options, onChange }: {
    label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void;
  }) => <select aria-label={label} value={value} onChange={event => {
    onChange(event.target.value); 
  }}>
    {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>,
  default: ({ onChange }: { onChange: (value: string) => void }) =>
    <button onClick={() => {
      onChange('prom'); 
    }}>Select datasource</button>,
}));
afterEach(() => {
  cleanup(); vi.resetAllMocks(); 
});

it.each(['mapping', 'navigation'])('saves inherited revision through selected owner via %s and resets without losing custom definitions', async mode => {
  const inherited: MetricDefinition = {
    id: 'cpu', name: 'CPU', resource_keys: ['k8s:/pods'], unit: 'cores', semantics: 'rate', dimensions: [],
    supported_shapes: ['current', 'range'], query_language: 'promql', query: 'rate(cpu[5m])',
    field_bindings: [], identity_labels: ['pod'], reducer: 'none', batch_strategy: 'identity',
    revision: 'kubernetes-cadvisor-v1', native: true,
  };
  const custom = { ...inherited, id: 'custom', name: 'Custom metric', query: 'custom_cpu', revision: 'custom-1', native: false };
  let saved = [custom];
  api.saved.mockImplementation(async () => saved);
  api.owner.mockImplementation(async (plugin, connection) => {
    if (plugin !== 'kubernetes' || connection !== 'cluster') {
      throw new Error('Wrong owner');
    }

    return { definitions: [saved.find(value => value.id === 'cpu') ?? inherited, custom], scope_fields: [] };
  });
  api.save.mockImplementation(async (plugin, connection, definition) => {
    if (plugin !== 'kubernetes' || connection !== 'cluster' || definition.revision !== inherited.revision) {
      throw new Error('CONFLICT');
    }

    const result = { ...definition, revision: 'profile-2' };
    saved = [custom, result];
    return result;
  });
  api.remove.mockImplementation(async id => {
    saved = saved.filter(value => value.id !== id); 
  });
  let navigation: { save: () => Promise<boolean> } | null = null;
  await act(async () => {
    render(<GrafanaSettings registerNavigation={value => {
      navigation = value; 
    }} />);
  });
  fireEvent.click(screen.getByRole('tab', { name: 'Global mappings' }));
  expect(screen.getByRole('button', { name: /Add metric/ })).toBeDisabled();
  await act(async () => {
    fireEvent.click(screen.getByText('Select resource owner')); 
  });
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Provider connection'), { target: { value: 'monitor' } }); 
  });
  fireEvent.click(screen.getByText('Select datasource'));
  fireEvent.click(screen.getByText('CPU', { selector: 'strong' }));
  const cpu = screen.getByText('CPU', { selector: 'strong' }).closest('details')!;
  fireEvent.change(within(cpu).getByLabelText('PromQL'), { target: { value: 'rate(cpu[6m])' } });
  expect(screen.getByText('Select resource owner')).toBeDisabled();
  if (mode === 'mapping') {
    await act(async () => {
      fireEvent.click(within(cpu).getByRole('button', { name: 'Validate definition' })); 
    });
    await act(async () => {
      fireEvent.click(within(cpu).getByRole('button', { name: 'Save mapping' })); 
    });
  } else {
    await act(async () => {
      expect(await navigation!.save()).toBe(true); 
    });
  }

  expect(screen.getByText('Custom metric', { selector: 'strong' })).toBeInTheDocument();
  const savedCPU = screen.getByText('CPU', { selector: 'strong' }).closest('details')!;
  savedCPU.open = true;
  expect(within(savedCPU).getByLabelText('PromQL')).toHaveValue('rate(cpu[6m])');
  const customEditor = screen.getByText('Custom metric', { selector: 'strong' }).closest('details')!;
  customEditor.open = true;
  fireEvent.change(within(customEditor).getByLabelText('PromQL'), { target: { value: 'custom_cpu + 1' } });
  await act(async () => {
    fireEvent.click(within(savedCPU).getByRole('button', { name: 'Reset to owner default' })); 
  });
  const resetCPU = screen.getByText('CPU', { selector: 'strong' }).closest('details')!;
  expect(within(resetCPU).getByLabelText('PromQL')).toHaveValue('rate(cpu[5m])');
  expect(screen.queryByRole('button', { name: 'Reset to owner default' })).toBeNull();
  expect(screen.getByText('Custom metric', { selector: 'strong' })).toBeInTheDocument();
  const retainedCustom = screen.getByText('Custom metric', { selector: 'strong' }).closest('details')!;
  expect(within(retainedCustom).getByLabelText('PromQL')).toHaveValue('custom_cpu + 1');
  expect(screen.getByText('Select resource owner')).toBeDisabled();
});
