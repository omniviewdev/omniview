import { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import { ProgressBar, ProgressRing } from '@omniviewdev/ui/feedback';

export default function ProgressPage() {
  const [animatedValue, setAnimatedValue] = useState(0);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      setAnimatedValue((v) => {
        if (v >= 100) { setRunning(false); return 100; }
        return v + 2;
      });
    }, 100);
    return () => clearInterval(interval);
  }, [running]);

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}>
        Progress Indicators
      </Typography>

      {/* ProgressBar (Linear) */}
      <Section title="ProgressBar" description="Linear progress indicator with size variants, colors, labels, and value display. Supports determinate and indeterminate modes.">
        <ImportStatement code="import { ProgressBar } from '@omniviewdev/ui/feedback';" />

        <Example title="Sizes">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 400 }}>
            <ProgressBar value={60} size="xs" label="xs" />
            <ProgressBar value={60} size="sm" label="sm" />
            <ProgressBar value={60} size="md" label="md" />
            <ProgressBar value={60} size="lg" label="lg" />
            <ProgressBar value={60} size="xl" label="xl" />
          </Box>
        </Example>

        <Example title="Colors">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 400 }}>
            <ProgressBar value={80} color="primary" label="Primary" size="md" />
            <ProgressBar value={65} color="success" label="Success" size="md" />
            <ProgressBar value={45} color="warning" label="Warning" size="md" />
            <ProgressBar value={30} color="danger" label="Danger" size="md" />
            <ProgressBar value={55} color="info" label="Info" size="md" />
          </Box>
        </Example>

        <Example title="With Value Display">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 400 }}>
            <ProgressBar value={73} label="Upload progress" showValue size="md" color="primary" />
            <ProgressBar value={100} label="Complete" showValue size="md" color="success" />
          </Box>
        </Example>

        <Example title="Indeterminate">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 400 }}>
            <ProgressBar indeterminate label="Loading..." size="sm" color="primary" />
            <ProgressBar indeterminate size="xs" color="info" />
          </Box>
        </Example>

        <Example title="Animated Progress">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxWidth: 400 }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <Chip
                label={running ? 'Running...' : animatedValue >= 100 ? 'Done! Click to reset' : 'Start'}
                onClick={() => {
                  if (animatedValue >= 100) setAnimatedValue(0);
                  else setRunning(true);
                }}
                size="small"
                sx={{ cursor: 'pointer' }}
              />
            </Box>
            <ProgressBar
              value={animatedValue}
              label="Build progress"
              showValue
              size="md"
              color={animatedValue >= 100 ? 'success' : 'primary'}
            />
          </Box>
        </Example>
      </Section>

      {/* ProgressRing (Circular) */}
      <Section title="ProgressRing" description="Circular progress indicator with size variants, center labels, captions, and both determinate/indeterminate modes.">
        <ImportStatement code="import { ProgressRing } from '@omniviewdev/ui/feedback';" />

        <Example title="Sizes">
          <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <ProgressRing value={65} size="xs" caption="xs" />
            <ProgressRing value={65} size="sm" caption="sm" />
            <ProgressRing value={65} size="md" caption="md" />
            <ProgressRing value={65} size="lg" caption="lg" />
            <ProgressRing value={65} size="xl" caption="xl" />
          </Box>
        </Example>

        <Example title="With Value Display">
          <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <ProgressRing value={25} size="lg" showValue caption="Download" color="info" />
            <ProgressRing value={73} size="lg" showValue caption="Upload" color="primary" />
            <ProgressRing value={100} size="lg" showValue caption="Complete" color="success" />
          </Box>
        </Example>

        <Example title="Colors">
          <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <ProgressRing value={60} size="md" showValue color="primary" caption="Primary" />
            <ProgressRing value={60} size="md" showValue color="success" caption="Success" />
            <ProgressRing value={60} size="md" showValue color="warning" caption="Warning" />
            <ProgressRing value={60} size="md" showValue color="danger" caption="Danger" />
            <ProgressRing value={60} size="md" showValue color="info" caption="Info" />
            <ProgressRing value={60} size="md" showValue color="neutral" caption="Neutral" />
          </Box>
        </Example>

        <Example title="Indeterminate">
          <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <ProgressRing size="sm" caption="Loading" color="primary" />
            <ProgressRing size="md" caption="Syncing" color="info" />
            <ProgressRing size="lg" caption="Processing" color="warning" />
          </Box>
        </Example>

        <Example title="Custom Labels">
          <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <ProgressRing
              value={3}
              size="xl"
              label={
                <Box sx={{ textAlign: 'center' }}>
                  <Typography sx={{ fontSize: '1.25rem', fontWeight: 700, lineHeight: 1, color: 'var(--ov-fg-base)' }}>3</Typography>
                  <Typography sx={{ fontSize: '0.5rem', color: 'var(--ov-fg-faint)', lineHeight: 1 }}>errors</Typography>
                </Box>
              }
              color="danger"
              caption="Build"
            />
            <ProgressRing
              value={87}
              size="xl"
              label={
                <Box sx={{ textAlign: 'center' }}>
                  <Typography sx={{ fontSize: '1rem', fontWeight: 700, lineHeight: 1, color: 'var(--ov-fg-base)' }}>87%</Typography>
                  <Typography sx={{ fontSize: '0.5rem', color: 'var(--ov-fg-faint)', lineHeight: 1 }}>health</Typography>
                </Box>
              }
              color="success"
              caption="Cluster"
            />
          </Box>
        </Example>

        <Example title="Dashboard-Style Metrics">
          <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {[
              { label: 'CPU', value: 42, color: 'info' as const },
              { label: 'Memory', value: 78, color: 'warning' as const },
              { label: 'Disk', value: 23, color: 'success' as const },
              { label: 'Network', value: 91, color: 'danger' as const },
            ].map((m) => (
              <Box key={m.label} sx={{ textAlign: 'center' }}>
                <ProgressRing value={m.value} size="lg" showValue color={m.color} />
                <Typography sx={{ fontSize: 'var(--ov-text-xs)', color: 'var(--ov-fg-muted)', mt: 0.5, fontWeight: 500 }}>
                  {m.label}
                </Typography>
              </Box>
            ))}
          </Box>
        </Example>
      </Section>
    </Box>
  );
}
