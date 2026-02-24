import { useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { LuFile, LuSettings, LuTerminal, LuPalette } from 'react-icons/lu';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { Spotlight } from '@omniviewdev/ui/overlays';
import type { SpotlightResultItem } from '@omniviewdev/ui/overlays';
import { Button } from '@omniviewdev/ui/buttons';

const allItems: SpotlightResultItem[] = [
  { id: '1', label: 'main.go', description: 'backend/main.go', icon: <LuFile size={14} />, section: 'Files', onSelect: () => {} },
  { id: '2', label: 'vite.config.ts', description: 'packages/omniviewdev-ui/vite.config.ts', icon: <LuFile size={14} />, section: 'Files', onSelect: () => {} },
  { id: '3', label: 'Toggle Dark Mode', icon: <LuPalette size={14} />, section: 'Commands', onSelect: () => {} },
  { id: '4', label: 'Open Terminal', icon: <LuTerminal size={14} />, section: 'Commands', onSelect: () => {} },
  { id: '5', label: 'Theme Settings', description: 'Customize colors and fonts', icon: <LuSettings size={14} />, section: 'Settings', onSelect: () => {} },
  { id: '6', label: 'Plugin Settings', description: 'Manage installed plugins', icon: <LuSettings size={14} />, section: 'Settings', onSelect: () => {} },
];

export default function SpotlightPage() {
  const [open, setOpen] = useState(false);

  const handleSearch = useCallback((query: string): SpotlightResultItem[] => {
    const q = query.toLowerCase();
    return allItems.filter((item) =>
      item.label.toLowerCase().includes(q) ||
      item.description?.toLowerCase().includes(q)
    );
  }, []);

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}>
        Spotlight Search
      </Typography>

      <Section title="Spotlight" description="Enhanced command palette with sectioned results. Supports async search, keyboard navigation, and recent items.">
        <ImportStatement code="import { Spotlight } from '@omniviewdev/ui/overlays';" />

        <Example title="Interactive Demo" description="Click the button or press Cmd+K to open.">
          <Button emphasis="soft" color="primary" onClick={() => setOpen(true)}>
            Open Spotlight (Cmd+K)
          </Button>

          <Spotlight
            open={open}
            onClose={() => setOpen(false)}
            onSearch={handleSearch}
            recentItems={allItems.slice(0, 3)}
          />
        </Example>

        <PropsTable
          props={[
            { name: 'open', type: 'boolean', description: 'Whether the spotlight is visible.' },
            { name: 'onClose', type: '() => void', description: 'Called when the user closes the spotlight.' },
            { name: 'onSearch', type: '(query: string) => SpotlightResultItem[] | Promise<...>', description: 'Search callback. Can be sync or async.' },
            { name: 'placeholder', type: 'string', default: '"Search commands, files, settings..."', description: 'Input placeholder text.' },
            { name: 'recentItems', type: 'SpotlightResultItem[]', description: 'Items shown when query is empty.' },
            { name: 'width', type: 'number', default: '560', description: 'Panel width in pixels.' },
          ]}
        />
      </Section>
    </Box>
  );
}
