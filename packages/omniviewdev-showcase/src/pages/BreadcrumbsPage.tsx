import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { LuHouse, LuServer, LuBox } from 'react-icons/lu';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { Breadcrumbs, Stepper, Pagination } from '@omniviewdev/ui/navigation';
import type { StepItem } from '@omniviewdev/ui/navigation';
import { useState } from 'react';

const steps: StepItem[] = [
  { label: 'Select cluster' },
  { label: 'Choose namespace' },
  { label: 'Configure resource', description: 'Set labels and annotations' },
  { label: 'Review & deploy', optional: true },
];

export default function BreadcrumbsPage() {
  const [page, setPage] = useState(1);
  const [activeStep, setActiveStep] = useState(1);

  return (
    <Box>
      <Typography
        variant="h4"
        sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}
      >
        Navigation
      </Typography>

      {/* Breadcrumbs */}
      <Section title="Breadcrumbs" description="Breadcrumb trail for resource navigation.">
        <ImportStatement code="import { Breadcrumbs } from '@omniviewdev/ui/navigation';" />

        <Example title="Basic">
          <Breadcrumbs
            items={[
              { label: 'Home', icon: <LuHouse size={14} />, onClick: () => {} },
              { label: 'production-cluster', icon: <LuServer size={14} />, onClick: () => {} },
              { label: 'default', onClick: () => {} },
              { label: 'nginx-deployment', icon: <LuBox size={14} /> },
            ]}
          />
        </Example>

        <Example title="With Max Items" description="Collapses middle items when maxItems is set.">
          <Breadcrumbs
            maxItems={3}
            items={[
              { label: 'Cluster', onClick: () => {} },
              { label: 'Namespace', onClick: () => {} },
              { label: 'Deployments', onClick: () => {} },
              { label: 'nginx', onClick: () => {} },
              { label: 'Pod: nginx-abc123' },
            ]}
          />
        </Example>

        <PropsTable
          props={[
            { name: 'items', type: 'BreadcrumbItem[]', description: 'Breadcrumb items (label, href, icon, onClick)' },
            { name: 'separator', type: 'ReactNode', default: "'/'", description: 'Separator between items' },
            { name: 'maxItems', type: 'number', description: 'Collapse middle items if exceeded' },
          ]}
        />
      </Section>

      {/* Stepper */}
      <Section title="Stepper" description="Step-by-step progress indicator.">
        <ImportStatement code="import { Stepper } from '@omniviewdev/ui/navigation';" />

        <Example title="Horizontal">
          <Stepper steps={steps} activeStep={activeStep} />
          <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
            <button onClick={() => setActiveStep(Math.max(0, activeStep - 1))}>Back</button>
            <button onClick={() => setActiveStep(Math.min(steps.length, activeStep + 1))}>Next</button>
          </Box>
        </Example>

        <Example title="Vertical">
          <Stepper steps={steps} activeStep={2} orientation="vertical" />
        </Example>

        <PropsTable
          props={[
            { name: 'steps', type: 'StepItem[]', description: 'Step definitions (label, description, icon, optional)' },
            { name: 'activeStep', type: 'number', description: 'Current active step index' },
            { name: 'orientation', type: "'horizontal' | 'vertical'", default: "'horizontal'", description: 'Layout direction' },
            { name: 'variant', type: "'linear' | 'nonLinear'", default: "'linear'", description: 'Navigation mode' },
          ]}
        />
      </Section>

      {/* Pagination */}
      <Section title="Pagination" description="Page navigation with compact and full variants.">
        <ImportStatement code="import { Pagination } from '@omniviewdev/ui/navigation';" />

        <Example title="Full (default)">
          <Pagination count={10} page={page} onChange={setPage} />
        </Example>

        <Example title="Compact">
          <Pagination count={10} page={page} onChange={setPage} variant="compact" />
        </Example>

        <PropsTable
          props={[
            { name: 'count', type: 'number', description: 'Total number of pages' },
            { name: 'page', type: 'number', description: 'Current page' },
            { name: 'onChange', type: '(page: number) => void', description: 'Page change handler' },
            { name: 'variant', type: "'compact' | 'full'", default: "'full'", description: 'Display mode' },
            { name: 'size', type: 'ComponentSize', default: "'md'", description: 'Component size' },
          ]}
        />
      </Section>
    </Box>
  );
}
