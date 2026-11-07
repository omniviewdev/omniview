import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { MetricGrid } from './MetricGrid';

it('shows histogram dimensions rather than serialized series identity after selection', async () => {
  const points = ['list', 'watch'].map(operation => ({
    attributes: { operation }, value: 0, count: 5, sum: 8,
    bounds: [1], bucketCounts: [2, 3], startTime: '2026-11-07T00:00:00Z',
  }));
  render(<MetricGrid metrics={[{ name: 'operation.duration', description: 'Latency', kind: 'histogram', unit: 'ms', points }]} samples={[]} updating={false} health={undefined} />);
  const trigger = screen.getByLabelText('operation.duration distribution series');
  expect(trigger).toHaveTextContent('operation: list');
  fireEvent.click(trigger);
  const option = await screen.findByRole('option', { name: 'operation: watch' });
  fireEvent.pointerDown(option, { pointerType: 'mouse', button: 0 });
  fireEvent.pointerUp(option, { pointerType: 'mouse', button: 0 });
  fireEvent.click(option);
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  expect(trigger).toHaveTextContent('operation: watch');
  expect(trigger).not.toHaveTextContent(JSON.stringify([['operation', 'watch']]));
});
