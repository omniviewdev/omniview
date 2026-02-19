import { useState, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { Tabs, TabPanel } from '../navigation';
import { CodeBlock } from '../typography';
import DescriptionList from './DescriptionList';
import type { DescriptionItem } from './types';

export interface ObjectInspectorTab {
  key: string;
  label: string;
  content: React.ReactNode;
}

export interface ObjectInspectorProps {
  data: object;
  title?: string;
  tabs?: ObjectInspectorTab[];
  defaultTab?: string;
  readOnly?: boolean;
  sx?: SxProps<Theme>;
}

function flattenObject(obj: Record<string, any>, prefix = ''): DescriptionItem[] {
  const items: DescriptionItem[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      items.push(...flattenObject(value, fullKey));
    } else {
      items.push({
        label: fullKey,
        value: Array.isArray(value) ? value.join(', ') : String(value ?? '—'),
        copyable: true,
      });
    }
  }
  return items;
}

export default function ObjectInspector({
  data,
  title,
  tabs: customTabs,
  defaultTab,
  sx,
}: ObjectInspectorProps) {
  const summaryItems = useMemo(() => flattenObject(data as Record<string, any>), [data]);
  const yamlContent = useMemo(() => {
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return '{}';
    }
  }, [data]);

  const defaultTabs = useMemo(
    () => [
      {
        key: 'summary',
        label: 'Summary',
        content: <DescriptionList items={summaryItems} columns={2} />,
      },
      {
        key: 'yaml',
        label: 'YAML',
        content: <CodeBlock language="yaml" lineNumbers>{yamlContent}</CodeBlock>,
      },
      {
        key: 'json',
        label: 'JSON',
        content: <CodeBlock language="json" lineNumbers>{yamlContent}</CodeBlock>,
      },
    ],
    [summaryItems, yamlContent],
  );

  const allTabs = useMemo(
    () => [...defaultTabs, ...(customTabs ?? [])],
    [defaultTabs, customTabs],
  );

  const [activeTab, setActiveTab] = useState(defaultTab ?? allTabs[0]?.key ?? 'summary');

  return (
    <Box
      sx={{
        border: '1px solid var(--ov-border-default)',
        borderRadius: '6px',
        overflow: 'hidden',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      }}
    >
      {title && (
        <Box
          sx={{
            px: 2,
            py: 1,
            borderBottom: '1px solid var(--ov-border-default)',
            bgcolor: 'var(--ov-bg-surface)',
          }}
        >
          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'var(--ov-fg-base)' }}>
            {title}
          </Typography>
        </Box>
      )}

      <Box sx={{ px: 2, pt: 1 }}>
        <Tabs
          tabs={allTabs.map((t) => ({ key: t.key, label: t.label }))}
          value={activeTab}
          onChange={setActiveTab}
          size="sm"
        />
      </Box>

      <Box sx={{ p: 2 }}>
        {allTabs.map((tab) => (
          <TabPanel key={tab.key} value={tab.key} activeValue={activeTab}>
            {tab.content}
          </TabPanel>
        ))}
      </Box>
    </Box>
  );
}

ObjectInspector.displayName = 'ObjectInspector';
