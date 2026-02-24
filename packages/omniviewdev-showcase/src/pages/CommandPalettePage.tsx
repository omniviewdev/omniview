import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { LuSearch, LuSettings, LuFile, LuTerminal, LuGitBranch } from 'react-icons/lu';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { CommandPalette } from '@omniviewdev/ui/editors';
import type { CommandItem } from '@omniviewdev/ui/editors';
import { Button } from '@omniviewdev/ui/buttons';

const sampleCommands: CommandItem[] = [
  { id: 'open-file', label: 'Open File', icon: <LuFile size={16} />, category: 'File', shortcut: '⌘P', description: 'Open a file by name' },
  { id: 'find', label: 'Find in Files', icon: <LuSearch size={16} />, category: 'Search', shortcut: '⇧⌘F' },
  { id: 'terminal', label: 'Toggle Terminal', icon: <LuTerminal size={16} />, category: 'View', shortcut: '⌃`' },
  { id: 'settings', label: 'Open Settings', icon: <LuSettings size={16} />, category: 'Preferences', shortcut: '⌘,' },
  { id: 'git-checkout', label: 'Git: Checkout Branch', icon: <LuGitBranch size={16} />, category: 'Git' },
  { id: 'git-commit', label: 'Git: Commit', icon: <LuGitBranch size={16} />, category: 'Git' },
  { id: 'format', label: 'Format Document', category: 'Editor', shortcut: '⇧⌥F' },
  { id: 'minimap', label: 'Toggle Minimap', category: 'View' },
  { id: 'word-wrap', label: 'Toggle Word Wrap', category: 'Editor', shortcut: '⌥Z' },
  { id: 'zoom-in', label: 'Zoom In', category: 'View', shortcut: '⌘+' },
  { id: 'zoom-out', label: 'Zoom Out', category: 'View', shortcut: '⌘-' },
];

export default function CommandPalettePage() {
  const [basicOpen, setBasicOpen] = useState(false);
  const [categorizedOpen, setCategorizedOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<CommandItem | null>(null);

  return (
    <Box>
      <Typography
        variant="h4"
        sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}
      >
        CommandPalette
      </Typography>

      <Section
        title="CommandPalette"
        description="Searchable command palette overlay for quick access to actions. Supports keyboard navigation, categories, and shortcuts."
      >
        <ImportStatement code="import { CommandPalette } from '@omniviewdev/ui/editors';" />

        <Example title="Basic">
          <Button emphasis="outline" color="primary" size="sm" onClick={() => setBasicOpen(true)}>
            Open Command Palette
          </Button>
          {selectedItem && (
            <Typography variant="body2" sx={{ mt: 1, color: 'var(--ov-fg-muted)' }}>
              Last selected: {selectedItem.label}
            </Typography>
          )}
          <CommandPalette
            open={basicOpen}
            onClose={() => setBasicOpen(false)}
            items={sampleCommands}
            onSelect={(item) => setSelectedItem(item)}
            recentItems={sampleCommands.slice(0, 3)}
          />
        </Example>

        <Example title="With Categories" description="Items are grouped by their category field.">
          <Button emphasis="outline" color="accent" size="sm" onClick={() => setCategorizedOpen(true)}>
            Open Categorized
          </Button>
          <CommandPalette
            open={categorizedOpen}
            onClose={() => setCategorizedOpen(false)}
            items={sampleCommands}
            onSelect={(item) => setSelectedItem(item)}
            categories={['File', 'Search', 'View', 'Editor', 'Git', 'Preferences']}
          />
        </Example>

        <PropsTable
          props={[
            { name: 'open', type: 'boolean', description: 'Whether the palette is visible' },
            { name: 'onClose', type: '() => void', description: 'Close handler' },
            { name: 'items', type: 'CommandItem[]', description: 'Available commands (id, label, icon, category, shortcut, description)' },
            { name: 'onSelect', type: '(item: CommandItem) => void', description: 'Selection handler' },
            { name: 'placeholder', type: 'string', default: "'Type a command...'", description: 'Search input placeholder' },
            { name: 'recentItems', type: 'CommandItem[]', description: 'Items shown when search is empty' },
            { name: 'categories', type: 'string[]', description: 'Group items by category when set' },
          ]}
        />
      </Section>
    </Box>
  );
}
