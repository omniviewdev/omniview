import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { LuPlay, LuBug, LuDownload } from 'react-icons/lu';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { MenuBar, SplitButton } from '@omniviewdev/ui/menus';
import type { MenuBarItem, SplitButtonOption } from '@omniviewdev/ui/menus';

const menus: MenuBarItem[] = [
  {
    key: 'file',
    label: 'File',
    items: [
      { key: 'new', label: 'New File', shortcut: ['Meta', 'N'], onClick: () => {} },
      { key: 'open', label: 'Open...', shortcut: ['Meta', 'O'], onClick: () => {} },
      { key: 'save', label: 'Save', shortcut: ['Meta', 'S'], dividerAfter: true, onClick: () => {} },
      { key: 'exit', label: 'Exit', onClick: () => {} },
    ],
  },
  {
    key: 'edit',
    label: 'Edit',
    items: [
      { key: 'undo', label: 'Undo', shortcut: ['Meta', 'Z'], onClick: () => {} },
      { key: 'redo', label: 'Redo', shortcut: ['Meta', 'Shift', 'Z'], dividerAfter: true, onClick: () => {} },
      { key: 'cut', label: 'Cut', shortcut: ['Meta', 'X'], onClick: () => {} },
      { key: 'copy', label: 'Copy', shortcut: ['Meta', 'C'], onClick: () => {} },
      { key: 'paste', label: 'Paste', shortcut: ['Meta', 'V'], onClick: () => {} },
    ],
  },
  {
    key: 'view',
    label: 'View',
    items: [
      { key: 'cmd-palette', label: 'Command Palette', shortcut: ['Meta', 'Shift', 'P'], onClick: () => {} },
      { key: 'terminal', label: 'Terminal', shortcut: ['Meta', '`'], dividerAfter: true, onClick: () => {} },
      { key: 'zoom-in', label: 'Zoom In', shortcut: ['Meta', '='], onClick: () => {} },
      { key: 'zoom-out', label: 'Zoom Out', shortcut: ['Meta', '-'], onClick: () => {} },
    ],
  },
];

const splitOptions: SplitButtonOption[] = [
  { key: 'run', label: 'Run', icon: <LuPlay size={14} /> },
  { key: 'debug', label: 'Debug', icon: <LuBug size={14} /> },
  { key: 'export', label: 'Export', icon: <LuDownload size={14} /> },
];

export default function MenuBarPage() {
  const [lastSplit, setLastSplit] = useState('');

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}>
        Menu Bar & Split Button
      </Typography>

      <Section title="MenuBar" description="Horizontal File | Edit | View style menu bar. Click opens dropdown, hovering switches between open menus.">
        <ImportStatement code="import { MenuBar } from '@omniviewdev/ui/menus';" />

        <Example title="Application Menu Bar">
          <MenuBar menus={menus} />
        </Example>

        <PropsTable
          props={[
            { name: 'menus', type: 'MenuBarItem[]', description: 'Array of top-level menu definitions.' },
            { name: 'sx', type: 'SxProps<Theme>', description: 'Style overrides.' },
          ]}
        />
      </Section>

      <Section title="SplitButton" description="Button + dropdown arrow. Main area triggers the selected option, arrow opens dropdown to change selection.">
        <ImportStatement code="import { SplitButton } from '@omniviewdev/ui/menus';" />

        <Example title="Basic SplitButton">
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <SplitButton
              options={splitOptions}
              onSelect={(opt) => setLastSplit(opt.label)}
            />
            <Typography sx={{ fontSize: 'var(--ov-text-sm)', color: 'var(--ov-fg-muted)' }}>
              {lastSplit ? `Selected: ${lastSplit}` : 'Click an option'}
            </Typography>
          </Box>
        </Example>

        <Example title="Color Variants">
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <SplitButton options={splitOptions} onSelect={() => {}} color="primary" emphasis="soft" />
            <SplitButton options={splitOptions} onSelect={() => {}} color="success" emphasis="soft" />
            <SplitButton options={splitOptions} onSelect={() => {}} color="danger" emphasis="outline" />
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'options', type: 'SplitButtonOption[]', description: 'Options to choose from.' },
            { name: 'onSelect', type: '(option: SplitButtonOption) => void', description: 'Called when an option is selected.' },
            { name: 'defaultIndex', type: 'number', default: '0', description: 'Initially selected option index.' },
            { name: 'color', type: 'SemanticColor', default: '"primary"', description: 'Button color.' },
            { name: 'emphasis', type: 'Emphasis', default: '"soft"', description: 'Button emphasis.' },
            { name: 'size', type: 'ComponentSize', default: '"sm"', description: 'Button size.' },
          ]}
        />
      </Section>
    </Box>
  );
}
