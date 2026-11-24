import { Button, ProgressBar, Stack, Text } from '@omniviewdev/kit';
import { useState } from 'react';

/** Measurable work: fill the track to a percentage and describe the units separately. */
export const Determinate = () => (
  <Stack gap={4}>
    <Text variant="caption">Exporting report: 2 of 5 sections</Text>
    <ProgressBar label="Export report" value={40} valueText="2 of 5 sections" />
  </Stack>
);

/** Paused work keeps its last measured value and uses a muted fill. */
export const Paused = () => (
  <Stack gap={4}>
    <Text variant="caption">Upload paused at 64%</Text>
    <ProgressBar label="Upload files" value={64} valueText="Paused at 64%" paused />
  </Stack>
);

/** Work without a known percentage: the default full-width moving stripe. */
export const Indeterminate = () => (
  <Stack gap={4}>
    <Text variant="caption">Scanning files…</Text>
    <ProgressBar label="Scan files" value="indeterminate" valueText="Scanning…" />
  </Stack>
);

/** The alternate indeterminate paint: a short segment sweeps across the track. */
export const Sweep = () => (
  <Stack gap={4}>
    <Text variant="caption">Preparing preview…</Text>
    <ProgressBar label="Prepare preview" value="indeterminate" valueText="Preparing…" indeterminateMotion="sweep" />
  </Stack>
);

/** Change the measurement, pause the work, or mark its total unknown without remounting the bar. */
export function Interactive() {
  const [percent, setPercent] = useState(30);
  const [paused, setPaused] = useState(false);
  const [indeterminate, setIndeterminate] = useState(false);
  const measurement = indeterminate ? 'Total unknown' : `${String(percent)}% complete`;
  const status = paused ? `Paused. ${measurement}` : measurement;
  const canAdvance = !indeterminate && !paused && percent < 100;

  return (
    <Stack gap={8}>
      <Stack gap={4}>
        <Text variant="caption">Download archive: {status}</Text>
        <ProgressBar label="Download archive" value={indeterminate ? 'indeterminate' : percent} valueText={status} paused={paused} />
      </Stack>
      <Stack gap={4} align="start">
        <Button onClick={() => {
          setPercent((current) => Math.min(100, current + 10));
        }} disabledReason={canAdvance ? undefined : status}>
          Advance
        </Button>
        <Button onClick={() => {
          setPaused((current) => !current);
        }}>{paused ? 'Resume' : 'Pause'}</Button>
        <Button onClick={() => {
          setIndeterminate((current) => !current);
        }}>{indeterminate ? 'Set measured' : 'Set unknown'}</Button>
      </Stack>
    </Stack>
  );
}
