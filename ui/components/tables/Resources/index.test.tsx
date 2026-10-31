import React from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import type * as Runtime from '@omniviewdev/runtime';
import type { ResourceTableRow } from '@/hooks/resource/useResourceDefinition';

const state = vi.hoisted<{ error: unknown; isCurrent: boolean }>(() => ({ error: undefined, isCurrent: true }));
vi.mock('@/hooks/resource/useResourceDefinition', () => ({ default: () => ({ isLoading: false, isError: !!state.error, error: state.error, columns: { defs: [], visibility: {} } }) }));
vi.mock('@omniviewdev/runtime/api', () => ({ ResourceClient: {} }));
vi.mock('@omniviewdev/runtime', async (original) => {
  const actual = await original<typeof Runtime>();
  return { ...actual,
    useResourceType: () => ({ resourceType: { data: { displayName: 'Objects', defaultRepresentation: 'raw', representations: [{ id: 'raw' }], capabilities: [{ operation: 'enumerate' }], queryDimensions: [], identityDimensions: [] } } }),
    useResolvedResourceTarget: () => ({ data: { targetId: 'host-target', target: {} }, isLoading: false }),
    useResources: () => ({ isAcquiredRequestCurrent: state.isCurrent, membershipStale: true, resources: { refetch: vi.fn(), data: { records: [{ key: 'host-key', record: { reference: { address: { id: 'canonical-id', scope: [] } }, body: { kind: 'uint64', value: '18446744073709551615' } } }], sourcePage: {} }, isLoading: false } }),
  };
});
vi.mock('./ResourceTableContainer', () => ({ default: ({ columns, data }: { columns: Array<{ id: string; accessorFn: (row: ResourceTableRow) => React.ReactNode }>; data: ResourceTableRow[] }) => <div>{columns.map((column) => <span key={column.id}>{column.accessorFn(data[0])}</span>)}</div> }));
import ResourceTable from './index';

function show(code: string) {
  state.error = { code, title: code, message: code };
  return render(<QueryClientProvider client={new QueryClient()}><ResourceTable pluginID="p" connectionID="c" resourceKey="objects" /></QueryClientProvider>);
}

describe('optional presentation', () => {
  it('renders canonical references and lossless raw bodies when presentation is absent', () => {
    show('UNSUPPORTED');
    expect(screen.getByText('canonical-id')).toBeTruthy();
    expect(screen.getByText('18446744073709551615')).toBeTruthy();
  });
  it.each(['FORBIDDEN', 'UNAUTHORIZED', 'PROVIDER_ERROR'])('does not treat %s as absent presentation', (code) => {
    show(code);
    expect(screen.queryByText('canonical-id')).toBeNull();
    expect(screen.getByText('Failed to load resources')).toBeTruthy();
  });
});
