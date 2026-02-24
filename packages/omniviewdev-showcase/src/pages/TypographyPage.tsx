import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { Text, Heading, CodeInline, CodeBlock } from '@omniviewdev/ui/typography';

export default function TypographyPage() {
  return (
    <Box>
      <Typography
        variant="h4"
        sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}
      >
        Typography
      </Typography>

      {/* ---- Text ---- */}
      <Section
        title="Text"
        description="Base text component with variant, color, truncation, and line clamping support."
      >
        <ImportStatement code="import { Text } from '@omniviewdev/ui/typography';" />

        <Example title="Variants">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Text variant="body">Body text (default)</Text>
            <Text variant="caption">Caption text</Text>
            <Text variant="overline">Overline text</Text>
            <Text variant="mono">Monospace text</Text>
            <Text variant="code">Inline code variant</Text>
          </Box>
        </Example>

        <Example title="Colors">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            <Text color="primary">Primary</Text>
            <Text color="success">Success</Text>
            <Text color="warning">Warning</Text>
            <Text color="error">Error</Text>
            <Text color="info">Info</Text>
            <Text muted>Muted (shorthand)</Text>
          </Box>
        </Example>

        <Example title="Truncation" description="Single line truncation with ellipsis.">
          <Box sx={{ maxWidth: 200 }}>
            <Text truncate>
              This is a very long text that should be truncated with an ellipsis at the end.
            </Text>
          </Box>
        </Example>

        <Example title="Line clamping" description="Multi-line truncation with -webkit-line-clamp.">
          <Box sx={{ maxWidth: 300 }}>
            <Text lines={2}>
              This is a long paragraph that will be clamped to exactly two lines.
              Any content beyond the second line will be hidden with an ellipsis.
              This third line should not be visible.
            </Text>
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'variant', type: '"body" | "caption" | "overline" | "mono" | "code"', default: '"body"', description: 'Text style variant.' },
            { name: 'color', type: 'SemanticColor', description: 'Text color.' },
            { name: 'truncate', type: 'boolean', default: 'false', description: 'Single-line ellipsis truncation.' },
            { name: 'lines', type: 'number', description: 'Max lines before clamping.' },
            { name: 'muted', type: 'boolean', default: 'false', description: 'Shorthand for muted color.' },
            { name: 'inline', type: 'boolean', default: 'false', description: 'Render as span instead of p.' },
          ]}
        />
      </Section>

      {/* ---- Heading ---- */}
      <Section
        title="Heading"
        description="Semantic heading component mapping level 1-6 to MUI h1-h6."
      >
        <ImportStatement code="import { Heading } from '@omniviewdev/ui/typography';" />

        <Example title="Levels">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Heading level={1}>Heading Level 1</Heading>
            <Heading level={2}>Heading Level 2</Heading>
            <Heading level={3}>Heading Level 3</Heading>
            <Heading level={4}>Heading Level 4</Heading>
            <Heading level={5}>Heading Level 5</Heading>
            <Heading level={6}>Heading Level 6</Heading>
          </Box>
        </Example>

        <Example title="With anchor link" description="Hover to see the link icon for copying anchor URLs.">
          <Heading level={3} id="demo-heading" copyLink>
            Heading with anchor
          </Heading>
        </Example>

        <PropsTable
          props={[
            { name: 'level', type: '1 | 2 | 3 | 4 | 5 | 6', default: '2', description: 'Heading level.' },
            { name: 'id', type: 'string', description: 'HTML id for anchor linking.' },
            { name: 'copyLink', type: 'boolean', default: 'false', description: 'Show copy-link icon on hover.' },
          ]}
        />
      </Section>

      {/* ---- CodeInline ---- */}
      <Section
        title="CodeInline"
        description="Inline code element with monospace font and subtle background."
      >
        <ImportStatement code="import { CodeInline } from '@omniviewdev/ui/typography';" />

        <Example title="In context">
          <Text>
            Run <CodeInline>kubectl get pods</CodeInline> to list all pods in the current namespace.
          </Text>
        </Example>
      </Section>

      {/* ---- CodeBlock ---- */}
      <Section
        title="CodeBlock"
        description="Multi-line code block with optional line numbers and copy button."
      >
        <ImportStatement code="import { CodeBlock } from '@omniviewdev/ui/typography';" />

        <Example title="Default">
          <CodeBlock>{`apiVersion: v1
kind: Pod
metadata:
  name: nginx
  labels:
    app: nginx
spec:
  containers:
  - name: nginx
    image: nginx:latest
    ports:
    - containerPort: 80`}</CodeBlock>
        </Example>

        <Example title="With line numbers">
          <CodeBlock lineNumbers>{`const greeting = "Hello, World!";
console.log(greeting);

function add(a: number, b: number) {
  return a + b;
}`}</CodeBlock>
        </Example>

        <Example title="With max height and wrapping">
          <CodeBlock maxHeight={120} wrap>{`This is a very long line of text that should wrap when the wrap prop is enabled. It demonstrates how the CodeBlock component handles text wrapping gracefully instead of requiring horizontal scrolling for content that exceeds the container width.

Second paragraph with more text.
Third line.
Fourth line.
Fifth line.
Sixth line - this should be scrollable.`}</CodeBlock>
        </Example>

        <PropsTable
          props={[
            { name: 'children', type: 'string', description: 'Code content.' },
            { name: 'language', type: 'string', description: 'Language hint (for future syntax highlighting).' },
            { name: 'lineNumbers', type: 'boolean', default: 'false', description: 'Show line numbers.' },
            { name: 'copy', type: 'boolean', default: 'true', description: 'Show copy button.' },
            { name: 'maxHeight', type: 'number | string', description: 'Max height before scrolling.' },
            { name: 'wrap', type: 'boolean', default: 'false', description: 'Enable word wrapping.' },
          ]}
        />
      </Section>
    </Box>
  );
}
