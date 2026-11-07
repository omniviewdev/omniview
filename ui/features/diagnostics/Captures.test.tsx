import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptureSummary } from './model';
import { Captures } from './Captures';

const service = vi.hoisted(() => ({ GetCapture: vi.fn(), CompareCaptures: vi.fn(), StartCapture: vi.fn(), CancelCapture: vi.fn() }));
vi.mock('@omniviewdev/runtime/api', () => ({ Diagnostics: service }));
const refresh = vi.fn().mockResolvedValue(undefined);
const coverage = { complete: true, errors: 0, dropped: 0, gaps: 0, lastError: '', remoteErrors: 0, remoteDropped: 0 };
const identity = { instanceID: 'profile', sessionID: 'session', generation: 'generation', version: 'test', revision: 'commit', sourceState: 'clean', buildDate: '', configID: 'config', configScope: 'test' };
const captures: CaptureSummary[] = ['Before', 'After'].map((name, index) => ({
  schemaVersion: 1, id: String(index), name, workload: 'same', status: 'complete', identity,
  startedAt: '2026-11-07T00:00:00Z', endedAt: '2026-11-07T00:00:02Z', durationSeconds: 2, elapsedSeconds: 2, sampleCount: 1, coverage, error: '',
}));

beforeEach(() => {
  vi.clearAllMocks();
  service.GetCapture.mockImplementation(async (id: string) => Promise.resolve({
    ...captures.find(capture => capture.id === id),
    samples: [{ timestamp: '2026-11-07T00:00:02Z', health: coverage, metrics: Array.from({ length: 25 }, (_, index) => ({ name: `saved-${index + 1}`, description: `Saved metric ${index + 1}`, unit: '{item}', kind: 'gauge', points: [] })) }],
  }));
  service.CompareCaptures.mockResolvedValue({ baseline: '0', candidate: '1', compatible: true, warnings: [], metrics: Array.from({ length: 81 }, (_, index) => ({ name: `compared-${index + 1}`, unit: '{item}', kind: 'gauge', attributes: {}, baseline: 1, candidate: 2, delta: 1, valid: true, semantics: 'sampled mean', warning: '' })) });
});

async function chooseCapture(label: string, optionName: string) {
  fireEvent.click(screen.getByLabelText(label));
  const option = await screen.findByRole('option', { name: optionName });
  fireEvent.pointerDown(option, { pointerType: 'mouse', button: 0 });
  fireEvent.pointerUp(option, { pointerType: 'mouse', button: 0 });
  fireEvent.click(option);
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
}

describe('capture measurement pagination', () => {
  it('makes saved measurements beyond 24 reachable and resets on a different capture', async () => {
    render(<Captures captures={captures} refresh={refresh} maxSeconds={300} />);
    fireEvent.click(screen.getByRole('button', { name: 'Before' }));
    expect(await screen.findByText('Saved metric 1')).toBeVisible();
    expect(screen.queryByText('Saved metric 25')).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Saved capture measurement pages' })).getByText('2'));
    expect(await screen.findByText('Saved metric 25')).toBeVisible();
    expect(screen.queryByText('Saved metric 1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'After' }));
    expect(await screen.findByText('Saved metric 1')).toBeVisible();
    expect(screen.queryByText('Saved metric 25')).not.toBeInTheDocument();
  });

  it('makes comparison rows beyond 80 reachable and resets after selection changes', async () => {
    render(<Captures captures={captures} refresh={refresh} maxSeconds={300} />);
    await chooseCapture('Baseline capture', 'Before · complete');
    await chooseCapture('Candidate capture', 'After · complete');
    const compare = screen.getByRole('button', { name: 'Compare captures' });
    await waitFor(() => expect(compare).toBeEnabled());
    fireEvent.click(compare);
    expect(await screen.findByText('compared-1')).toBeVisible();
    expect(within(screen.getByRole('table', { name: 'Compared measurements' })).getAllByRole('row')).toHaveLength(81);
    expect(screen.queryByText('compared-81')).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Comparison pages' })).getByText('2'));
    expect(await screen.findByText('compared-81')).toBeVisible();
    expect(screen.queryByText('compared-1')).not.toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: 'Compared measurements' })).getAllByRole('row')).toHaveLength(2);
    await chooseCapture('Candidate capture', 'Before · complete');
    expect(screen.queryByRole('table', { name: 'Compared measurements' })).not.toBeInTheDocument();
    expect(compare).toBeDisabled();
    await chooseCapture('Candidate capture', 'After · complete');
    await waitFor(() => expect(compare).toBeEnabled());
    fireEvent.click(compare);
    expect(await screen.findByText('compared-1')).toBeVisible();
    expect(screen.queryByText('compared-81')).not.toBeInTheDocument();
  });
});
