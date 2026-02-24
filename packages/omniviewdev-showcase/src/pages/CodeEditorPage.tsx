import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { CodeEditor, DiffViewer } from '@omniviewdev/ui/editors';

const sampleYaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx
  namespace: default
  labels:
    app: nginx
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
        - name: nginx
          image: nginx:1.25
          ports:
            - containerPort: 80`;

const sampleJson = `{
  "apiVersion": "v1",
  "kind": "ConfigMap",
  "metadata": {
    "name": "app-config",
    "namespace": "default"
  },
  "data": {
    "DATABASE_URL": "postgres://localhost:5432/mydb",
    "CACHE_TTL": "300",
    "LOG_LEVEL": "info"
  }
}`;

const originalYaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx
spec:
  replicas: 2
  template:
    spec:
      containers:
        - name: nginx
          image: nginx:1.24`;

const modifiedYaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx
  labels:
    version: "2"
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: nginx
          image: nginx:1.25
          resources:
            requests:
              cpu: 100m
              memory: 128Mi`;

export default function CodeEditorPage() {
  const [yamlValue, setYamlValue] = useState(sampleYaml);

  return (
    <Box>
      <Typography
        variant="h4"
        sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}
      >
        Editors
      </Typography>

      {/* CodeEditor */}
      <Section title="CodeEditor" description="Monaco-based code editor with Omniview themes and Ctrl+S save support.">
        <ImportStatement code="import { CodeEditor } from '@omniviewdev/ui/editors';" />

        <Example title="YAML Editor">
          <CodeEditor
            value={yamlValue}
            onChange={setYamlValue}
            language="yaml"
            maxHeight={300}
          />
        </Example>

        <Example title="JSON (Read-only)">
          <CodeEditor
            value={sampleJson}
            language="json"
            readOnly
            maxHeight={250}
          />
        </Example>

        <Example title="With Minimap and Word Wrap">
          <CodeEditor
            value={sampleYaml}
            language="yaml"
            minimap
            wordWrap
            maxHeight={300}
          />
        </Example>

        <PropsTable
          props={[
            { name: 'value', type: 'string', description: 'Editor content' },
            { name: 'onChange', type: '(value: string) => void', description: 'Content change handler' },
            { name: 'language', type: 'string', default: "'yaml'", description: 'Language for syntax highlighting' },
            { name: 'readOnly', type: 'boolean', default: 'false', description: 'Disable editing' },
            { name: 'minimap', type: 'boolean', default: 'false', description: 'Show minimap' },
            { name: 'lineNumbers', type: 'boolean', default: 'true', description: 'Show line numbers' },
            { name: 'wordWrap', type: 'boolean', default: 'false', description: 'Enable word wrapping' },
            { name: 'maxHeight', type: 'number | string', description: 'Maximum editor height' },
            { name: 'theme', type: 'string', default: "'omniview-dark'", description: 'Monaco theme name' },
            { name: 'onSave', type: '(value: string) => void', description: 'Ctrl+S / Cmd+S save handler' },
          ]}
        />
      </Section>

      {/* DiffViewer */}
      <Section title="DiffViewer" description="Side-by-side or unified diff comparison using Monaco.">
        <ImportStatement code="import { DiffViewer } from '@omniviewdev/ui/editors';" />

        <Example title="Side by Side">
          <DiffViewer
            original={originalYaml}
            modified={modifiedYaml}
            language="yaml"
            layout="sideBySide"
          />
        </Example>

        <Example title="Unified">
          <DiffViewer
            original={originalYaml}
            modified={modifiedYaml}
            language="yaml"
            layout="unified"
          />
        </Example>

        <PropsTable
          props={[
            { name: 'original', type: 'string', description: 'Original content' },
            { name: 'modified', type: 'string', description: 'Modified content' },
            { name: 'language', type: 'string', default: "'yaml'", description: 'Language for highlighting' },
            { name: 'layout', type: "'sideBySide' | 'unified'", default: "'sideBySide'", description: 'Diff layout mode' },
            { name: 'readOnly', type: 'boolean', default: 'true', description: 'Disable editing' },
          ]}
        />
      </Section>
    </Box>
  );
}
