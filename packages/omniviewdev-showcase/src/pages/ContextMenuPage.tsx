import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { LuCopy, LuScissors, LuClipboard, LuTrash2, LuFilePen, LuFolderOpen } from 'react-icons/lu';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { ContextMenu, DropdownMenu } from '@omniviewdev/ui/menus';
import type { ContextMenuItem } from '@omniviewdev/ui/menus';

const basicItems: ContextMenuItem[] = [
  { key: 'cut', label: 'Cut', icon: <LuScissors size={14} />, shortcut: ['Meta', 'X'], onClick: () => {} },
  { key: 'copy', label: 'Copy', icon: <LuCopy size={14} />, shortcut: ['Meta', 'C'], onClick: () => {} },
  { key: 'paste', label: 'Paste', icon: <LuClipboard size={14} />, shortcut: ['Meta', 'V'], dividerAfter: true, onClick: () => {} },
  { key: 'delete', label: 'Delete', icon: <LuTrash2 size={14} />, color: 'danger', onClick: () => {} },
];

const nestedItems: ContextMenuItem[] = [
  { key: 'new', label: 'New', icon: <LuFilePen size={14} />, children: [
    { key: 'new-file', label: 'File', shortcut: ['Meta', 'N'], onClick: () => {} },
    { key: 'new-folder', label: 'Folder', onClick: () => {} },
    { key: 'new-from-template', label: 'From Template...', dividerAfter: true, onClick: () => {} },
    { key: 'new-window', label: 'New Window', shortcut: ['Meta', 'Shift', 'N'], onClick: () => {} },
  ]},
  { key: 'open', label: 'Open', icon: <LuFolderOpen size={14} />, children: [
    { key: 'open-file', label: 'Open File...', shortcut: ['Meta', 'O'], onClick: () => {} },
    { key: 'open-folder', label: 'Open Folder...', onClick: () => {} },
    { key: 'open-recent', label: 'Open Recent', children: [
      { key: 'recent-1', label: 'project-alpha', onClick: () => {} },
      { key: 'recent-2', label: 'project-beta', onClick: () => {} },
    ]},
  ]},
  { key: 'sep', label: '', dividerAfter: true, onClick: () => {} },
  ...basicItems,
];

export default function ContextMenuPage() {
  const [lastAction, setLastAction] = useState('(right-click the box below)');

  const trackableItems: ContextMenuItem[] = basicItems.map(item => ({
    ...item,
    onClick: () => setLastAction(`Clicked: ${item.label}`),
  }));

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}>
        Context Menu
      </Typography>

      <Section title="ContextMenu" description="Right-click triggered context menu with keyboard shortcuts, icons, disabled items, and nested submenus.">
        <ImportStatement code="import { ContextMenu } from '@omniviewdev/ui/menus';" />

        <Example title="Basic Context Menu" description="Right-click the box below to open a context menu.">
          <ContextMenu items={trackableItems}>
            <Box
              sx={{
                p: 4,
                border: '2px dashed var(--ov-border-default)',
                borderRadius: '8px',
                textAlign: 'center',
                bgcolor: 'var(--ov-bg-surface-inset)',
                cursor: 'context-menu',
              }}
            >
              <Typography sx={{ color: 'var(--ov-fg-muted)', fontSize: 'var(--ov-text-sm)' }}>
                Right-click here
              </Typography>
              <Typography sx={{ color: 'var(--ov-fg-faint)', fontSize: 'var(--ov-text-xs)', mt: 0.5 }}>
                {lastAction}
              </Typography>
            </Box>
          </ContextMenu>
        </Example>

        <Example title="Nested Submenus" description="Menu items with children render as flyout submenus.">
          <ContextMenu items={nestedItems}>
            <Box
              sx={{
                p: 4,
                border: '2px dashed var(--ov-border-default)',
                borderRadius: '8px',
                textAlign: 'center',
                bgcolor: 'var(--ov-bg-surface-inset)',
                cursor: 'context-menu',
              }}
            >
              <Typography sx={{ color: 'var(--ov-fg-muted)', fontSize: 'var(--ov-text-sm)' }}>
                Right-click for nested menu
              </Typography>
            </Box>
          </ContextMenu>
        </Example>

        <PropsTable
          props={[
            { name: 'items', type: 'ContextMenuItem[]', description: 'Menu items to display.' },
            { name: 'children', type: 'ReactNode', description: 'Content that gets the right-click handler.' },
            { name: 'onOpenChange', type: '(open: boolean) => void', description: 'Called when menu opens/closes.' },
          ]}
        />
      </Section>

      <Section title="DropdownMenu" description="Click-triggered dropdown menu. Same items interface as ContextMenu.">
        <ImportStatement code="import { DropdownMenu } from '@omniviewdev/ui/menus';" />

        <Example title="Click Triggered" description="Click the button to open a dropdown menu.">
          <DropdownMenu
            items={basicItems}
            trigger={
              <Box
                sx={{
                  px: 2,
                  py: 0.75,
                  bgcolor: 'var(--ov-accent-subtle)',
                  color: 'var(--ov-accent-fg)',
                  borderRadius: '4px',
                  fontSize: 'var(--ov-text-sm)',
                  fontWeight: 500,
                  display: 'inline-flex',
                  cursor: 'pointer',
                  '&:hover': { filter: 'brightness(0.95)' },
                }}
              >
                Open Menu
              </Box>
            }
          />
        </Example>
      </Section>
    </Box>
  );
}
