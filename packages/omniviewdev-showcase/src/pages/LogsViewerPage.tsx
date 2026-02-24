import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { LogsViewer } from '@omniviewdev/ui/domain';
import type { LogLine } from '@omniviewdev/ui/domain';

const sampleLines: LogLine[] = [
  { timestamp: '2024-01-15T10:30:01Z', content: 'Starting nginx server...', severity: 'info' },
  { timestamp: '2024-01-15T10:30:02Z', content: 'Listening on port 80', severity: 'info' },
  { timestamp: '2024-01-15T10:30:05Z', content: 'GET / 200 0.003s', severity: 'info' },
  { timestamp: '2024-01-15T10:30:06Z', content: 'GET /favicon.ico 404 0.001s', severity: 'warn' },
  { timestamp: '2024-01-15T10:30:10Z', content: 'GET /api/health 200 0.002s', severity: 'info' },
  { timestamp: '2024-01-15T10:30:15Z', content: 'Connection refused to upstream backend:8080', severity: 'error' },
  { timestamp: '2024-01-15T10:30:16Z', content: 'Retrying connection in 5s...', severity: 'warn' },
  { timestamp: '2024-01-15T10:30:21Z', content: 'Upstream connection restored', severity: 'info' },
  { timestamp: '2024-01-15T10:30:22Z', content: 'GET /api/users 200 0.045s', severity: 'info' },
  { timestamp: '2024-01-15T10:30:25Z', content: 'DEBUG: cache hit ratio 0.85', severity: 'debug' },
  { timestamp: '2024-01-15T10:30:26Z', content: 'GET /api/users/123 200 0.012s', severity: 'info' },
  { timestamp: '2024-01-15T10:30:30Z', content: 'POST /api/users 201 0.089s', severity: 'info' },
  { timestamp: '2024-01-15T10:30:31Z', content: 'Failed to parse request body: invalid JSON', severity: 'error' },
  { timestamp: '2024-01-15T10:30:32Z', content: 'POST /api/users 400 0.001s', severity: 'warn' },
  { timestamp: '2024-01-15T10:30:35Z', content: 'DEBUG: GC pause 2.3ms', severity: 'debug' },
];

export default function LogsViewerPage() {
  const [lines, setLines] = useState(sampleLines);
  const [follow, setFollow] = useState(false);

  const addLine = () => {
    const severities: LogLine['severity'][] = ['info', 'warn', 'error', 'debug'];
    const messages = [
      'GET /api/health 200 0.001s',
      'Connection timeout after 30s',
      'Cache invalidation triggered',
      'DEBUG: memory usage 142MB',
    ];
    const sev = severities[Math.floor(Math.random() * severities.length)];
    const msg = messages[Math.floor(Math.random() * messages.length)];
    setLines((prev) => [
      ...prev,
      {
        timestamp: new Date().toISOString(),
        content: msg,
        severity: sev,
      },
    ]);
  };

  return (
    <Box>
      <Typography
        variant="h4"
        sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}
      >
        LogsViewer
      </Typography>

      <Section
        title="LogsViewer"
        description="Virtual-scrolled log viewer with severity coloring, line numbers, timestamps, and follow mode."
      >
        <ImportStatement code="import { LogsViewer } from '@omniviewdev/ui/domain';" />

        <Example title="Basic">
          <LogsViewer lines={sampleLines} />
        </Example>

        <Example title="With Follow Mode" description="Click 'Add Line' to append and auto-scroll.">
          <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
            <Button size="small" variant="outlined" onClick={addLine}>
              Add Line
            </Button>
            <Button size="small" variant={follow ? 'contained' : 'outlined'} onClick={() => setFollow(!follow)}>
              Follow: {follow ? 'On' : 'Off'}
            </Button>
          </Box>
          <LogsViewer lines={lines} follow={follow} />
        </Example>

        <Example title="Word Wrap">
          <LogsViewer lines={sampleLines} wrap />
        </Example>

        <Example title="Without Timestamps">
          <LogsViewer lines={sampleLines} timestamps={false} />
        </Example>

        <Example title="Filtered by Severity (error only)">
          <LogsViewer lines={sampleLines} severity="error" />
        </Example>

        <Example title="Max Lines (5)">
          <LogsViewer lines={sampleLines} maxLines={5} />
        </Example>

        <PropsTable
          props={[
            { name: 'lines', type: 'LogLine[]', description: 'Array of log lines to display' },
            { name: 'follow', type: 'boolean', default: 'false', description: 'Auto-scroll to bottom on new lines' },
            { name: 'onFollow', type: '(follow: boolean) => void', description: 'Callback when follow changes' },
            { name: 'wrap', type: 'boolean', default: 'false', description: 'Enable word wrapping' },
            { name: 'timestamps', type: 'boolean', default: 'true', description: 'Show timestamp column' },
            { name: 'maxLines', type: 'number', description: 'Maximum lines to display (shows latest N)' },
            { name: 'severity', type: "'info' | 'warn' | 'error' | 'debug'", description: 'Filter to a specific severity level' },
          ]}
        />
      </Section>
    </Box>
  );
}
