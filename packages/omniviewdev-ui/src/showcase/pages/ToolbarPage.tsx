import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { LuBold, LuItalic, LuUnderline, LuAlignLeft, LuAlignCenter, LuAlignRight, LuList, LuListOrdered } from 'react-icons/lu';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { Toolbar, ToolbarGroup, ToggleButton, ToggleGroup, SearchBar } from '../../buttons';

export default function ToolbarPage() {
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  const [underline, setUnderline] = useState(false);
  const [alignment, setAlignment] = useState<string | string[]>('left');
  const [formats, setFormats] = useState<string | string[]>(['bold']);
  const [search, setSearch] = useState('');
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}>
        Toolbars
      </Typography>

      <Section title="Toolbar & ToolbarGroup" description="Horizontal flex containers for toolbar items with optional dividers between groups.">
        <ImportStatement code="import { Toolbar, ToolbarGroup } from '@omniviewdev/ui/buttons';" />

        <Example title="Toolbar with Groups & Dividers">
          <Toolbar dividers>
            <ToolbarGroup>
              <ToggleButton selected={bold} onChange={setBold} icon={<LuBold size={14} />} label="Bold" />
              <ToggleButton selected={italic} onChange={setItalic} icon={<LuItalic size={14} />} label="Italic" />
              <ToggleButton selected={underline} onChange={setUnderline} icon={<LuUnderline size={14} />} label="Underline" />
            </ToolbarGroup>
            <ToolbarGroup>
              <ToggleGroup
                value={alignment}
                onChange={setAlignment}
                exclusive
                options={[
                  { key: 'left', icon: <LuAlignLeft size={14} /> },
                  { key: 'center', icon: <LuAlignCenter size={14} /> },
                  { key: 'right', icon: <LuAlignRight size={14} /> },
                ]}
              />
            </ToolbarGroup>
          </Toolbar>
        </Example>

        <Example title="Dense Toolbar">
          <Toolbar variant="dense">
            <ToolbarGroup>
              <ToggleButton selected={false} onChange={() => {}} icon={<LuList size={12} />} label="Bullets" size="xs" />
              <ToggleButton selected={false} onChange={() => {}} icon={<LuListOrdered size={12} />} label="Numbered" size="xs" />
            </ToolbarGroup>
          </Toolbar>
        </Example>

        <PropsTable
          props={[
            { name: 'variant', type: '"default" | "dense"', default: '"default"', description: 'Toolbar height: default=36px, dense=28px.' },
            { name: 'dividers', type: 'boolean', default: 'false', description: 'Show separators between ToolbarGroup children.' },
          ]}
        />
      </Section>

      <Section title="ToggleButton" description="Single toggle button with selected/unselected state.">
        <ImportStatement code="import { ToggleButton } from '@omniviewdev/ui/buttons';" />

        <Example title="Interactive Toggle Buttons">
          <Box sx={{ display: 'flex', gap: 1 }}>
            <ToggleButton selected={bold} onChange={setBold} icon={<LuBold size={14} />} label="Bold" />
            <ToggleButton selected={italic} onChange={setItalic} icon={<LuItalic size={14} />} label="Italic" color="success" />
            <ToggleButton selected={underline} onChange={setUnderline} icon={<LuUnderline size={14} />} label="Underline" color="warning" />
          </Box>
        </Example>
      </Section>

      <Section title="ToggleGroup" description="Group of toggle buttons. Exclusive mode for radio-like behavior, or multi-select.">
        <ImportStatement code="import { ToggleGroup } from '@omniviewdev/ui/buttons';" />

        <Example title="Exclusive (Single Select)">
          <ToggleGroup
            value={alignment}
            onChange={setAlignment}
            exclusive
            options={[
              { key: 'left', label: 'Left', icon: <LuAlignLeft size={14} /> },
              { key: 'center', label: 'Center', icon: <LuAlignCenter size={14} /> },
              { key: 'right', label: 'Right', icon: <LuAlignRight size={14} /> },
            ]}
          />
        </Example>

        <Example title="Multi Select">
          <ToggleGroup
            value={formats}
            onChange={setFormats}
            exclusive={false}
            options={[
              { key: 'bold', label: 'Bold', icon: <LuBold size={14} /> },
              { key: 'italic', label: 'Italic', icon: <LuItalic size={14} /> },
              { key: 'underline', label: 'Underline', icon: <LuUnderline size={14} /> },
            ]}
          />
        </Example>
      </Section>

      <Section title="SearchBar" description="Full-featured search bar with regex/case-sensitive toggles, match counter, and prev/next navigation.">
        <ImportStatement code="import { SearchBar } from '@omniviewdev/ui/buttons';" />

        <Example title="Full Featured SearchBar">
          <SearchBar
            value={search}
            onChange={setSearch}
            regex={regex}
            caseSensitive={caseSensitive}
            onRegexChange={setRegex}
            onCaseSensitiveChange={setCaseSensitive}
            matchCount={search ? 42 : undefined}
            currentMatch={search ? 7 : undefined}
            onNext={() => {}}
            onPrev={() => {}}
          />
        </Example>

        <Example title="Minimal SearchBar">
          <SearchBar value="" onChange={() => {}} placeholder="Filter items..." />
        </Example>

        <Example title="Sizes">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <SearchBar value="" onChange={() => {}} placeholder="xs" size="xs" />
            <SearchBar value="" onChange={() => {}} placeholder="sm (default)" size="sm" />
            <SearchBar value="" onChange={() => {}} placeholder="md" size="md" />
            <SearchBar value="" onChange={() => {}} placeholder="lg" size="lg" />
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'value', type: 'string', description: 'Current search value.' },
            { name: 'onChange', type: '(value: string) => void', description: 'Called on input change.' },
            { name: 'regex', type: 'boolean', description: 'Whether regex mode is active.' },
            { name: 'caseSensitive', type: 'boolean', description: 'Whether case-sensitive mode is active.' },
            { name: 'onRegexChange', type: '(enabled: boolean) => void', description: 'Toggles regex mode. Omit to hide the toggle.' },
            { name: 'onCaseSensitiveChange', type: '(enabled: boolean) => void', description: 'Toggles case sensitivity. Omit to hide the toggle.' },
            { name: 'matchCount', type: 'number', description: 'Total match count to display.' },
            { name: 'currentMatch', type: 'number', description: '0-based current match index.' },
            { name: 'onNext', type: '() => void', description: 'Navigate to next match.' },
            { name: 'onPrev', type: '() => void', description: 'Navigate to previous match.' },
            { name: 'size', type: 'ComponentSize', default: '"sm"', description: 'Input height.' },
          ]}
        />
      </Section>
    </Box>
  );
}
