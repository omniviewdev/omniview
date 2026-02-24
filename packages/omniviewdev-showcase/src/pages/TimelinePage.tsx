import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { LuCircleCheck, LuCircleAlert, LuLoader, LuRocket, LuPackage, LuGitCommitHorizontal } from 'react-icons/lu';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { Timeline } from '@omniviewdev/ui/domain';
import type { TimelineEvent } from '@omniviewdev/ui/domain';

const deployEvents: TimelineEvent[] = [
  { id: '1', title: 'Deploy started', description: 'v2.4.1 rollout initiated', timestamp: '10:32:01', icon: <LuRocket size={14} />, color: 'info' },
  { id: '2', title: 'Image pulled', description: 'registry.io/app:v2.4.1', timestamp: '10:32:15', icon: <LuPackage size={14} />, color: 'neutral' },
  { id: '3', title: 'Health check passed', timestamp: '10:32:45', icon: <LuCircleCheck size={14} />, color: 'success' },
  { id: '4', title: 'Warning: High memory usage', description: 'Pod using 85% of memory limit', timestamp: '10:33:12', icon: <LuCircleAlert size={14} />, color: 'warning' },
  { id: '5', title: 'Scaling up to 3 replicas', timestamp: '10:33:30', icon: <LuLoader size={14} />, color: 'info' },
  { id: '6', title: 'Deploy complete', description: 'All 3 replicas healthy', timestamp: '10:34:00', icon: <LuCircleCheck size={14} />, color: 'success' },
];

const gitEvents: TimelineEvent[] = [
  { id: '1', title: 'feat: add filter bar component', timestamp: '2 hours ago', icon: <LuGitCommitHorizontal size={14} />, color: 'primary' },
  { id: '2', title: 'fix: correct menu positioning', timestamp: '3 hours ago', icon: <LuGitCommitHorizontal size={14} />, color: 'danger' },
  { id: '3', title: 'chore: update dependencies', timestamp: 'Yesterday', icon: <LuGitCommitHorizontal size={14} />, color: 'neutral' },
];

export default function TimelinePage() {
  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}>
        Timeline
      </Typography>

      <Section title="Timeline" description="Vertical event timeline with connected dots/lines. Each event has timestamp, title, description, icon, and color.">
        <ImportStatement code="import { Timeline } from '@omniviewdev/ui/domain';" />

        <Example title="Deployment Events">
          <Timeline events={deployEvents} />
        </Example>

        <Example title="Git History">
          <Timeline events={gitEvents} size="md" />
        </Example>

        <PropsTable
          props={[
            { name: 'events', type: 'TimelineEvent[]', description: 'Array of timeline events.' },
            { name: 'size', type: 'ComponentSize', default: '"sm"', description: 'Controls dot size and font size.' },
          ]}
        />
      </Section>
    </Box>
  );
}
