import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionDiagnosticSnapshot } from '@/features/extensions/diagnostics/types';
import ExtensionInspector from './ExtensionInspector';

const mocks = vi.hoisted(() => {
  const snapshot: ExtensionDiagnosticSnapshot = {
    schemaVersion: 1, capturedAt: '', windowName: 'main', points: [], pending: [], plugins: [], problems: [], coverage: [],
    limits: { quarantineCrashThreshold: 3, maxCrashRecordsPerContribution: 10 }, truncated: false,
  };
  return { snapshot, windowName: 'main', identityError: null as string | null, capture: vi.fn(), lookup: vi.fn(), unquarantine: vi.fn() };
});
vi.mock('@/features/extensions/diagnostics/useExtensionDiagnostics', () => ({ useExtensionDiagnostics: () => mocks }));
function renderInspector() {
  return render(<MemoryRouter initialEntries={['/developer-tools/extensions?point=omniview/resource/drawer&contribution=probe/drawer']}><ExtensionInspector /></MemoryRouter>);
}

beforeEach(() => {
  mocks.windowName = 'main'; mocks.identityError = null;
  mocks.snapshot = { schemaVersion: 1, capturedAt: '2026-11-01T00:00:00Z', windowName: 'main', points: [{ id: 'omniview/resource/drawer', owner: 'core', mode: 'single', version: 1, contributions: [{ id: 'probe/drawer', pluginId: 'probe', label: 'Probe drawer', source: 'modern', valueType: 'function', status: 'quarantined', crashCount: 3, resourceKey: 'core::v1::Pod' }] }], pending: [], plugins: [], problems: [], coverage: ['No successful-render instrumentation.'], limits: { quarantineCrashThreshold: 3, maxCrashRecordsPerContribution: 10 }, truncated: false };
  mocks.capture.mockImplementation(() => structuredClone(mocks.snapshot));
  mocks.lookup.mockReset(); mocks.unquarantine.mockReset();
});
afterEach(cleanup);
describe('Extension Inspector', () => {
  it('keeps passive inventory visible but disables actions until native identity resolves', () => {
    mocks.windowName = null;
    renderInspector();
    expect(screen.getByRole('treeitem', { name: /Probe drawer/ })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export safe JSON' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sensitive export…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Re-enable…' })).toBeDisabled();
  });
  it('does not execute matchers during passive inventory and filtering', () => {
    renderInspector();
    expect(screen.getByRole('treeitem', { name: /Probe drawer/ })).toBeVisible();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search extensions' }), { target: { value: 'missing' } });
    expect(screen.queryByRole('treeitem', { name: /Probe drawer/ })).not.toBeInTheDocument();
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.unquarantine).not.toHaveBeenCalled();
  });
  it('disables live actions while viewing a paused immutable snapshot', () => {
    renderInspector();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(screen.getByRole('button', { name: 'Re-enable…' })).toBeDisabled();
    fireEvent.click(screen.getByRole('tab', { name: 'Context lookup' }));
    expect(screen.getByRole('button', { name: 'Run lookup' })).toBeDisabled();
    expect(mocks.lookup).not.toHaveBeenCalled();
  });
  it('requires confirmation before recovery and preserves keyboard focus when the recovery button disappears', async () => {
    mocks.unquarantine.mockImplementation(() => {
      mocks.snapshot = { ...mocks.snapshot, points: mocks.snapshot.points.map(point => ({ ...point, contributions: point.contributions.map(entry => ({ ...entry, status: 'registered' as const, crashCount: 0 })) })) };
    });
    renderInspector();
    fireEvent.click(screen.getByRole('button', { name: 'Re-enable…' }));
    expect(screen.getByRole('dialog', { name: 'Re-enable contribution?' })).toBeVisible();
    expect(within(screen.getByRole('table', { name: 'Registered contributions' })).getByText('quarantined')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Re-enable', exact: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: 'Registered contributions' })).getByText('registered')).toBeVisible();
    await waitFor(() => expect(screen.getByRole('complementary', { name: 'Selected extension details' })).toHaveFocus());
  });
  it('keeps removed selection distinct from filtered no-results', () => {
    const view = renderInspector();
    mocks.snapshot = { ...mocks.snapshot, points: [] };
    view.rerender(<MemoryRouter initialEntries={['/developer-tools/extensions']}><ExtensionInspector /></MemoryRouter>);
    expect(screen.getByText('Selected registration was removed. Select another item.')).toBeVisible();
    expect(mocks.unquarantine).not.toHaveBeenCalled();
  });
  it('resolves duplicate contribution IDs through the requested point tuple', () => {
    mocks.snapshot.points.unshift({ id: 'probe/other-point', owner: 'probe', mode: 'single', version: 1, contributions: [{ ...mocks.snapshot.points[0].contributions[0], label: 'Other registration', source: 'wrong-point-source' }] });
    renderInspector();
    expect(screen.queryByText('wrong-point-source')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Probe drawer', level: 2 })).toBeVisible();
  });
  it('inspects module problems even when no contribution registered', () => {
    mocks.snapshot = { ...mocks.snapshot, points: [], plugins: [{ id: 'probe', phase: 'error', error: 'Diagnostic text withheld.', warnings: [] }], problems: [{ id: 'plugin:probe', kind: 'plugin-error', pluginId: 'probe', message: 'Plugin load failed.' }] };
    renderInspector();
    fireEvent.click(within(screen.getByRole('region', { name: 'Extension problems' })).getByText('Plugin load failed.'));
    const inspector = within(screen.getByRole('complementary', { name: 'Selected extension details' }));
    expect(inspector.getByText('error', { exact: true })).toBeVisible();
    expect(screen.getByText('Diagnostic text withheld.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reveal sensitive exception text…' })).toBeEnabled();
  });
  it('keeps a pending target outside registered inventory and context lookup', () => {
    mocks.snapshot = {
      ...mocks.snapshot,
      points: [],
      pending: [{ id: 'probe/pending', pluginId: 'probe', pointId: 'missing/panel', source: 'modern', status: 'pending-target' }],
    };
    renderInspector();
    fireEvent.click(screen.getByRole('treeitem', { name: /probe\/pending/ }));
    expect(within(screen.getByRole('complementary', { name: 'Selected extension details' })).getByRole('heading', { name: 'probe/pending', level: 2 })).toBeVisible();
    expect(screen.queryByRole('table', { name: 'Registered contributions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Context lookup' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Re-enable…' })).not.toBeInTheDocument();
  });
  it('groups repeated evidence without merging contribution tuples or dropping retained events', () => {
    const point = mocks.snapshot.points[0];
    point.contributions.push({ ...point.contributions[0], pluginId: 'other', label: 'Other plugin drawer', source: 'other-source' });
    mocks.snapshot.problems = [
      { id: 'probe:first', kind: 'render-error', pluginId: 'probe', pointId: point.id, contributionId: 'probe/drawer', message: 'First failure', timestamp: 1 },
      { id: 'probe:second', kind: 'render-error', pluginId: 'probe', pointId: point.id, contributionId: 'probe/drawer', message: 'Repeated failure', timestamp: 2 },
      { id: 'other:first', kind: 'render-error', pluginId: 'other', pointId: point.id, contributionId: 'probe/drawer', message: 'Other plugin failure', timestamp: 3 },
    ];
    renderInspector();
    const problems = within(screen.getByRole('table', { name: 'Captured problem groups' }));
    expect(problems.getAllByRole('row')).toHaveLength(3);
    fireEvent.click(problems.getByText('2 retained events'));
    expect(problems.getByText('probe:first')).toBeVisible();
    expect(problems.getByText('probe:second')).toBeVisible();
    fireEvent.click(problems.getByRole('button', { name: /Other plugin failure/ }));
    const inspector = within(screen.getByRole('complementary', { name: 'Selected extension details' }));
    expect(inspector.getByRole('heading', { name: 'Other plugin drawer' })).toBeVisible();
    expect(inspector.getByText('other-source')).toBeVisible();
    expect(inspector.queryByText('Repeated failure')).not.toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: /Other plugin drawer/ })).toBeVisible();
  });
});
