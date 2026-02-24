import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import PropsTable from '../helpers/PropsTable';
import ImportStatement from '../helpers/ImportStatement';

import { DebouncedInput, SearchInput } from '@omniviewdev/ui/inputs';

export default function InputsPage() {
  const [debouncedValue, setDebouncedValue] = useState('');
  const [debouncedInitial, setDebouncedInitial] = useState('hello world');
  const [debouncedFast, setDebouncedFast] = useState('');
  const [debouncedInteractive, setDebouncedInteractive] = useState('');

  const [searchValue, setSearchValue] = useState('');
  const [searchCustom, setSearchCustom] = useState('');
  const [searchInteractive, setSearchInteractive] = useState('');

  return (
    <Box>
      <Typography
        variant="h4"
        sx={{
          fontWeight: 'var(--ov-weight-bold)',
          color: 'var(--ov-fg-base)',
          mb: '32px',
        }}
      >
        Inputs
      </Typography>

      {/* ---- DebouncedInput ---- */}
      <Section
        title="DebouncedInput"
        description="A text input that debounces its onChange callback. Includes a search icon and clear button. Wraps MUI OutlinedInput with configurable debounce delay."
      >
        <ImportStatement code="import { DebouncedInput } from '@omniviewdev/ui/inputs';" />

        <Example title="Default" description="Basic usage with a placeholder.">
          <DebouncedInput
            value={debouncedValue}
            onChange={setDebouncedValue}
            placeholder="Type to search..."
          />
        </Example>

        <Example title="With initial value" description="Pre-populated with an initial value.">
          <DebouncedInput
            value={debouncedInitial}
            onChange={setDebouncedInitial}
          />
        </Example>

        <Example title="200ms debounce" description="Faster debounce for responsive filtering.">
          <DebouncedInput
            value={debouncedFast}
            onChange={setDebouncedFast}
            debounce={200}
            placeholder="Fast debounce (200ms)..."
          />
        </Example>

        <Example title="Interactive demo" description="Type in the input and watch the debounced output value update below after the delay.">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <DebouncedInput
              value={debouncedInteractive}
              onChange={setDebouncedInteractive}
              placeholder="Type something..."
            />
            <Box
              sx={{
                p: 2,
                borderRadius: '4px',
                bgcolor: 'var(--ov-bg-surface-inset)',
                fontFamily: 'var(--ov-font-mono)',
                fontSize: 'var(--ov-text-sm)',
                color: 'var(--ov-fg-default)',
              }}
            >
              Debounced value: <strong>{debouncedInteractive || '(empty)'}</strong>
            </Box>
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'value', type: 'string', description: 'The current input value.' },
            { name: 'onChange', type: '(value: string) => void', description: 'Called with the debounced value after the delay.' },
            { name: 'debounce', type: 'number', default: '500', description: 'Debounce delay in milliseconds.' },
            { name: 'placeholder', type: 'string', default: '"Search"', description: 'Placeholder text shown when the input is empty.' },
            { name: '...rest', type: 'OutlinedInputProps', description: 'All other MUI OutlinedInput props are forwarded.' },
          ]}
        />
      </Section>

      {/* ---- SearchInput ---- */}
      <Section
        title="SearchInput"
        description="A simple search input with icon and clear button. Unlike DebouncedInput, it fires onChange immediately on every keystroke."
      >
        <ImportStatement code="import { SearchInput } from '@omniviewdev/ui/inputs';" />

        <Example title="Default" description="Basic search input with default placeholder.">
          <SearchInput
            value={searchValue}
            onChange={setSearchValue}
          />
        </Example>

        <Example title="Custom placeholder" description="Override the default placeholder text.">
          <SearchInput
            value={searchCustom}
            onChange={setSearchCustom}
            placeholder="Filter resources..."
          />
        </Example>

        <Example title="Interactive demo" description="Type in the search input to see the value update immediately below.">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <SearchInput
              value={searchInteractive}
              onChange={setSearchInteractive}
              placeholder="Search pods..."
            />
            <Box
              sx={{
                p: 2,
                borderRadius: '4px',
                bgcolor: 'var(--ov-bg-surface-inset)',
                fontFamily: 'var(--ov-font-mono)',
                fontSize: 'var(--ov-text-sm)',
                color: 'var(--ov-fg-default)',
              }}
            >
              Current value: <strong>{searchInteractive || '(empty)'}</strong>
            </Box>
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'value', type: 'string', description: 'The current input value.' },
            { name: 'onChange', type: '(value: string) => void', description: 'Called immediately with the new value on each keystroke.' },
            { name: 'placeholder', type: 'string', default: '"Search"', description: 'Placeholder text shown when the input is empty.' },
          ]}
        />
      </Section>
    </Box>
  );
}
