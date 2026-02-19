import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { Tabs, TabPanel } from '../../navigation';
import type { TabItem } from '../../navigation';

const sampleTabs: TabItem[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'yaml', label: 'YAML' },
  { key: 'events', label: 'Events' },
  { key: 'logs', label: 'Logs' },
];

export default function TabsPage() {
  const [lineTab, setLineTab] = useState('overview');
  const [pillTab, setPillTab] = useState('overview');
  const [segTab, setSegTab] = useState('overview');
  const [closableTabs, setClosableTabs] = useState<TabItem[]>([...sampleTabs]);
  const [closableActive, setClosableActive] = useState('overview');

  return (
    <Box>
      <Typography
        variant="h4"
        sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}
      >
        Tabs
      </Typography>

      <Section title="Tabs" description="Tab navigation with line, pill, and segmented variants.">
        <ImportStatement code="import { Tabs, TabPanel } from '@omniviewdev/ui/navigation';" />

        <Example title="Line Variant (default)">
          <Tabs tabs={sampleTabs} value={lineTab} onChange={setLineTab} variant="line" />
          <Box sx={{ mt: 2, p: 2, bgcolor: 'var(--ov-bg-surface-inset)', borderRadius: 1 }}>
            <TabPanel value="overview" activeValue={lineTab}>Overview content</TabPanel>
            <TabPanel value="yaml" activeValue={lineTab}>YAML content</TabPanel>
            <TabPanel value="events" activeValue={lineTab}>Events content</TabPanel>
            <TabPanel value="logs" activeValue={lineTab}>Logs content</TabPanel>
          </Box>
        </Example>

        <Example title="Pill Variant">
          <Tabs tabs={sampleTabs} value={pillTab} onChange={setPillTab} variant="pill" />
        </Example>

        <Example title="Segmented Variant">
          <Tabs tabs={sampleTabs} value={segTab} onChange={setSegTab} variant="segmented" />
        </Example>

        <Example title="Closable with Add Button">
          <Tabs
            tabs={closableTabs}
            value={closableActive}
            onChange={setClosableActive}
            closable
            onClose={(key) => {
              setClosableTabs((prev) => prev.filter((t) => t.key !== key));
              if (closableActive === key) {
                setClosableActive(closableTabs[0]?.key ?? '');
              }
            }}
            addButton
            onAdd={() => {
              const newKey = `tab-${Date.now()}`;
              setClosableTabs((prev) => [...prev, { key: newKey, label: `Tab ${prev.length + 1}` }]);
              setClosableActive(newKey);
            }}
          />
        </Example>

        <Example title="Sizes">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {(['xs', 'sm', 'md', 'lg'] as const).map((size) => (
              <Box key={size}>
                <Typography variant="caption" sx={{ color: 'var(--ov-fg-muted)', mb: 0.5, display: 'block' }}>{size}</Typography>
                <Tabs tabs={sampleTabs.slice(0, 3)} value="overview" onChange={() => {}} size={size} />
              </Box>
            ))}
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'tabs', type: 'TabItem[]', description: 'Tab definitions (key, label, icon, disabled)' },
            { name: 'value', type: 'string', description: 'Currently active tab key' },
            { name: 'onChange', type: '(key: string) => void', description: 'Tab change handler' },
            { name: 'variant', type: "'line' | 'pill' | 'segmented'", default: "'line'", description: 'Visual style' },
            { name: 'size', type: 'ComponentSize', default: "'md'", description: 'Tab size' },
            { name: 'closable', type: 'boolean', default: 'false', description: 'Show close button per tab' },
            { name: 'onClose', type: '(key: string) => void', description: 'Tab close handler' },
            { name: 'scrollable', type: 'boolean', default: 'false', description: 'Enable horizontal scrolling' },
            { name: 'addButton', type: 'boolean', default: 'false', description: 'Show + button at the end' },
            { name: 'onAdd', type: '() => void', description: 'Add button handler' },
          ]}
        />
      </Section>
    </Box>
  );
}
