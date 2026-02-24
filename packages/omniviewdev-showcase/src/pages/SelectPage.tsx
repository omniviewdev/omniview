import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';
import SizePicker from '../helpers/SizePicker';

import { Select, Autocomplete } from '@omniviewdev/ui/inputs';
import type { AutocompleteOption } from '@omniviewdev/ui/inputs';
import type { ComponentSize } from '@omniviewdev/ui/types';

const fruitOptions = [
  { value: 'apple', label: 'Apple' },
  { value: 'banana', label: 'Banana' },
  { value: 'cherry', label: 'Cherry' },
  { value: 'date', label: 'Date' },
  { value: 'elderberry', label: 'Elderberry' },
  { value: 'fig', label: 'Fig' },
  { value: 'grape', label: 'Grape' },
];

const namespaceOptions = [
  { value: 'default', label: 'default' },
  { value: 'kube-system', label: 'kube-system' },
  { value: 'kube-public', label: 'kube-public' },
  { value: 'monitoring', label: 'monitoring' },
  { value: 'production', label: 'production' },
  { value: 'staging', label: 'staging' },
];

export default function SelectPage() {
  const [size, setSize] = useState<ComponentSize>('md');
  const [single, setSingle] = useState('');
  const [multi, setMulti] = useState<string[]>([]);
  const [searchable, setSearchable] = useState('');
  const [autoVal, setAutoVal] = useState<AutocompleteOption | null>(null);
  const [autoMulti, setAutoMulti] = useState<AutocompleteOption[]>([]);

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}>
        Select & Autocomplete
      </Typography>

      <Section title="Select" description="Dropdown select with searchable and multi-select modes.">
        <ImportStatement code="import { Select } from '@omniviewdev/ui/inputs';" />
        <SizePicker value={size} onChange={setSize} />

        <Example title="Single select">
          <Select options={fruitOptions} value={single} onChange={(v) => setSingle(v as string)} label="Fruit" placeholder="Choose a fruit" size={size} fullWidth sx={{ maxWidth: 300 }} />
        </Example>

        <Example title="Multi select">
          <Select options={namespaceOptions} value={multi} onChange={(v) => setMulti(v as string[])} label="Namespaces" multiple size={size} fullWidth sx={{ maxWidth: 400 }} />
        </Example>

        <Example title="Searchable">
          <Select options={fruitOptions} value={searchable} onChange={(v) => setSearchable(v as string)} label="Search fruits" searchable size={size} fullWidth sx={{ maxWidth: 300 }} />
        </Example>

        <PropsTable props={[
          { name: 'options', type: 'SelectOption[]', description: 'Array of { value, label, disabled?, icon? }.' },
          { name: 'value', type: 'string | string[]', description: 'Selected value(s).' },
          { name: 'onChange', type: '(value) => void', description: 'Selection change handler.' },
          { name: 'size', type: 'ComponentSize', default: 'md', description: 'xs | sm | md | lg | xl.' },
          { name: 'searchable', type: 'boolean', default: 'false', description: 'Add filter input in dropdown.' },
          { name: 'multiple', type: 'boolean', default: 'false', description: 'Allow multi-select.' },
          { name: 'loading', type: 'boolean', default: 'false', description: 'Show loading state.' },
        ]} />
      </Section>

      <Section title="Autocomplete" description="Type-ahead search with optional creatable mode.">
        <ImportStatement code="import { Autocomplete } from '@omniviewdev/ui/inputs';" />
        <SizePicker value={size} onChange={setSize} />

        <Example title="Single">
          <Autocomplete
            options={fruitOptions}
            value={autoVal}
            onChange={(v) => setAutoVal(v as AutocompleteOption | null)}
            label="Fruit"
            placeholder="Start typing..."
            size={size}
            fullWidth
            sx={{ maxWidth: 300 }}
          />
        </Example>

        <Example title="Multiple">
          <Autocomplete
            options={namespaceOptions}
            value={autoMulti}
            onChange={(v) => setAutoMulti(v as AutocompleteOption[])}
            label="Namespaces"
            multiple
            size={size}
            fullWidth
            sx={{ maxWidth: 400 }}
          />
        </Example>

        <Example title="Creatable" description="Allows typing new values not in the options list.">
          <Autocomplete
            options={fruitOptions}
            value={null}
            onChange={() => {}}
            label="Add new"
            creatable
            placeholder="Type to create..."
            size={size}
            fullWidth
            sx={{ maxWidth: 300 }}
          />
        </Example>

        <PropsTable props={[
          { name: 'options', type: 'AutocompleteOption[]', description: 'Array of { value, label }.' },
          { name: 'size', type: 'ComponentSize', default: 'md', description: 'xs | sm | md | lg | xl.' },
          { name: 'creatable', type: 'boolean', default: 'false', description: 'Allow free-text creation.' },
          { name: 'multiple', type: 'boolean', default: 'false', description: 'Allow multiple selections.' },
          { name: 'groupBy', type: '(option) => string', description: 'Group options by category.' },
        ]} />
      </Section>
    </Box>
  );
}
