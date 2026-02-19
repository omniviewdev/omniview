import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { TagInput, KeyValueEditor } from '../../inputs';

export default function TagInputPage() {
  const [tags, setTags] = useState<string[]>(['frontend', 'v2']);
  const [suggestedTags, setSuggestedTags] = useState<string[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({
    app: 'nginx',
    env: 'production',
  });
  const [emptyKV, setEmptyKV] = useState<Record<string, string>>({});

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}>
        TagInput & KeyValueEditor
      </Typography>

      <Section title="TagInput" description="Text input that creates chips. Press Enter or comma to add a tag.">
        <ImportStatement code="import { TagInput } from '@omniviewdev/ui/inputs';" />

        <Example title="Basic">
          <Box sx={{ maxWidth: 400 }}>
            <TagInput value={tags} onChange={setTags} placeholder="Add tag..." />
          </Box>
        </Example>

        <Example title="With suggestions">
          <Box sx={{ maxWidth: 400 }}>
            <TagInput
              value={suggestedTags}
              onChange={setSuggestedTags}
              suggestions={['kubernetes', 'docker', 'helm', 'istio', 'prometheus', 'grafana']}
              placeholder="Type to see suggestions..."
            />
          </Box>
        </Example>

        <Example title="Max tags (3)">
          <Box sx={{ maxWidth: 400 }}>
            <TagInput value={['a', 'b']} onChange={() => {}} maxTags={3} placeholder="Max 3 tags" />
          </Box>
        </Example>

        <PropsTable props={[
          { name: 'value', type: 'string[]', description: 'Current tags.' },
          { name: 'onChange', type: '(tags: string[]) => void', description: 'Called when tags change.' },
          { name: 'suggestions', type: 'string[]', description: 'Autocomplete suggestions.' },
          { name: 'maxTags', type: 'number', description: 'Maximum number of tags.' },
          { name: 'creatable', type: 'boolean', default: 'true', description: 'Allow creating new tags.' },
        ]} />
      </Section>

      <Section title="KeyValueEditor" description="Editable key-value pairs. Used for labels, annotations, environment variables.">
        <ImportStatement code="import { KeyValueEditor } from '@omniviewdev/ui/inputs';" />

        <Example title="With data">
          <Box sx={{ maxWidth: 500 }}>
            <KeyValueEditor value={labels} onChange={setLabels} />
          </Box>
        </Example>

        <Example title="Empty state">
          <Box sx={{ maxWidth: 500 }}>
            <KeyValueEditor value={emptyKV} onChange={setEmptyKV} addLabel="Add label" />
          </Box>
        </Example>

        <Example title="Read-only">
          <Box sx={{ maxWidth: 500 }}>
            <KeyValueEditor value={{ app: 'nginx', version: '1.25.3' }} onChange={() => {}} readOnly />
          </Box>
        </Example>

        <PropsTable props={[
          { name: 'value', type: 'Record<string, string>', description: 'Key-value pairs.' },
          { name: 'onChange', type: '(kv: Record<string, string>) => void', description: 'Called on change.' },
          { name: 'addLabel', type: 'string', default: '"Add"', description: 'Label for add button.' },
          { name: 'readOnly', type: 'boolean', default: 'false', description: 'Disable editing.' },
          { name: 'validateKey', type: '(key) => string | undefined', description: 'Key validation function.' },
          { name: 'validateValue', type: '(value) => string | undefined', description: 'Value validation function.' },
        ]} />
      </Section>
    </Box>
  );
}
