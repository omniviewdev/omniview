import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as Runtime from '@omniviewdev/runtime';
const hooks = vi.hoisted(() => ({ resources: vi.fn(), target: vi.fn() }));
vi.mock('@omniviewdev/runtime', async importOriginal => ({ ...await importOriginal<typeof Runtime>(), useResources: hooks.resources, useResolvedResourceTarget: hooks.target }));
import SampleResource from './SampleResource';
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const target = { targetId: 'owner-issued-target', target: { route: { connection: 'cluster' }, type: 'k8s:/pods', scope: [] } };
describe('real sample acquisition', () => {
  it('selects exact canonical namespace identity from a finite source snapshot', () => {
    hooks.target.mockReturnValue({ data: target, isLoading: false, error: null });
    const reference = { address: { provider: 'kubernetes', authority: 'cluster-authority', type: 'k8s:/pods', id: 'same-name', scope: [{ dimension: 'namespace', value: 'team-b' }] }, incarnation: 'pod-uid-b' };
    hooks.resources.mockReturnValue({ acquired: { page: { records: [
      { key: 'membership-a', record: { reference: { ...reference, address: { ...reference.address, scope: [{ dimension: 'namespace', value: 'team-a' }] } } }, route: { connection: 'cluster' } },
      { key: 'membership-b', record: { reference }, route: { connection: 'cluster' } },
    ] } }, resources: { error: null, isLoading: false }, sourceError: false, source: { state: 'finished' }, isSyncing: false });
    const select = vi.fn();
    render(<SampleResource pluginID="kubernetes" connectionID="cluster" resourceKey="k8s:/pods" onSelect={select} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Real sample resource' }), { target: { value: 'membership-b' } });
    expect(select).toHaveBeenLastCalledWith({ token: 'membership-b', resource_key: 'k8s:/pods', resource_id: 'same-name', resource_namespace: 'team-b', reference, route: { connection: 'cluster' } });
    expect(hooks.resources).toHaveBeenCalledWith(expect.objectContaining({ collection: true, live: false }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('renders the structured source failure instead of the sourceError boolean', () => {
    hooks.target.mockReturnValue({ data: target, isLoading: false, error: null });
    hooks.resources.mockReturnValue({ resources: { error: null, isLoading: false }, sourceError: true, source: { state: 'failed', error: {
      type: 'resource/forbidden', title: 'Access denied', status: 403, code: 'FORBIDDEN', detail: 'Your role cannot read Pods.',
    } }, isSyncing: false });
    render(<SampleResource pluginID="kubernetes" connectionID="cluster" resourceKey="k8s:/pods" onSelect={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Access denied (FORBIDDEN): Your role cannot read Pods.');
    expect(screen.getByRole('alert')).not.toHaveTextContent('unavailable: true');
    expect(screen.getAllByRole('option')).toHaveLength(1);
  });
});
