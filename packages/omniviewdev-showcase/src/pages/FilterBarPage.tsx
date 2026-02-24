import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { FilterBar } from '@omniviewdev/ui/domain';
import type { FilterDef, ActiveFilter } from '@omniviewdev/ui/domain';

const resourceFilters: FilterDef[] = [
  { key: 'namespace', label: 'Namespace', type: 'select', options: ['default', 'kube-system', 'monitoring', 'production'] },
  { key: 'kind', label: 'Kind', type: 'select', options: ['Pod', 'Service', 'Deployment', 'ConfigMap', 'Secret'] },
  { key: 'name', label: 'Name', type: 'text', placeholder: 'Filter by name...' },
  { key: 'label', label: 'Label', type: 'text', placeholder: 'app=nginx' },
];

export default function FilterBarPage() {
  const [filters, setFilters] = useState<ActiveFilter[]>([
    { key: 'namespace', value: 'default' },
  ]);

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}>
        Filter Bar
      </Typography>

      <Section title="FilterBar" description="Interactive filter chips bar. Each filter becomes a chip that opens a popover with controls. Active filters show values with X to remove.">
        <ImportStatement code="import { FilterBar } from '@omniviewdev/ui/domain';" />

        <Example title="Resource Filters" description="Click a filter chip to add/edit, X to remove.">
          <FilterBar
            filters={resourceFilters}
            activeFilters={filters}
            onChange={setFilters}
          />
          <Box sx={{ mt: 2 }}>
            <Typography sx={{ fontSize: 'var(--ov-text-xs)', color: 'var(--ov-fg-faint)' }}>
              Active: {JSON.stringify(filters)}
            </Typography>
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'filters', type: 'FilterDef[]', description: 'Available filter definitions.' },
            { name: 'activeFilters', type: 'ActiveFilter[]', description: 'Currently active filters.' },
            { name: 'onChange', type: '(filters: ActiveFilter[]) => void', description: 'Called when filters change.' },
          ]}
        />
      </Section>
    </Box>
  );
}
