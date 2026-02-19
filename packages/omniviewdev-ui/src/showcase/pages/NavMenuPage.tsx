import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import {
  LuSettings, LuUser, LuBell, LuPalette, LuKeyboard,
  LuGlobe, LuShield, LuDatabase, LuPlug,
} from 'react-icons/lu';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';
import SizePicker from '../helpers/SizePicker';

import { NavMenu } from '../../sidebars';
import type { NavSection } from '../../sidebars';
import type { ComponentSize } from '../../types';

const settingsNav: NavSection[] = [
  {
    title: 'User',
    items: [
      { id: 'profile', label: 'Profile', icon: <LuUser size={14} /> },
      { id: 'notifications', label: 'Notifications', icon: <LuBell size={14} />, badge: <Chip label="3" size="small" sx={{ height: 16, fontSize: 10, '& .MuiChip-label': { px: 0.5 } }} /> },
      { id: 'appearance', label: 'Appearance', icon: <LuPalette size={14} /> },
      { id: 'keybindings', label: 'Keyboard Shortcuts', icon: <LuKeyboard size={14} /> },
    ],
  },
  {
    title: 'Workspace',
    items: [
      { id: 'general', label: 'General', icon: <LuSettings size={14} /> },
      { id: 'language', label: 'Language & Region', icon: <LuGlobe size={14} /> },
      { id: 'security', label: 'Security', icon: <LuShield size={14} /> },
    ],
  },
  {
    title: 'Advanced',
    items: [
      { id: 'data', label: 'Data & Storage', icon: <LuDatabase size={14} /> },
      { id: 'plugins', label: 'Plugins', icon: <LuPlug size={14} />, children: [
        { id: 'installed', label: 'Installed' },
        { id: 'marketplace', label: 'Marketplace' },
        { id: 'dev', label: 'Development', disabled: true },
      ]},
    ],
  },
];

export default function NavMenuPage() {
  const [size, setSize] = useState<ComponentSize>('md');
  const [selected, setSelected] = useState('profile');

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}>
        NavMenu
      </Typography>

      <Section title="NavMenu" description="Vertical navigation list with sections. Used for settings panels, plugin navigation, and other sidebar menus.">
        <ImportStatement code="import { NavMenu } from '@omniviewdev/ui/sidebars';" />
        <SizePicker value={size} onChange={setSize} />

        <Example title="Settings Navigation" description="Grouped navigation with icons, badges, nested children, and disabled items.">
          <Box sx={{ width: 260, bgcolor: 'var(--ov-bg-surface)', border: '1px solid var(--ov-border-default)', borderRadius: 1, py: 1 }}>
            <NavMenu
              sections={settingsNav}
              selected={selected}
              onSelect={setSelected}
              size={size}
            />
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'sections', type: 'NavSection[]', description: 'Navigation sections with header + items.' },
            { name: 'selected', type: 'string', description: 'Currently selected item id.' },
            { name: 'onSelect', type: '(id: string) => void', description: 'Called when an item is clicked.' },
            { name: 'size', type: 'ComponentSize', default: "'md'", description: 'Controls font size.' },
          ]}
        />
      </Section>
    </Box>
  );
}
