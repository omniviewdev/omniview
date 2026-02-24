import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import PropsTable from '../helpers/PropsTable';
import ImportStatement from '../helpers/ImportStatement';

import TextCell from '@omniviewdev/ui/cells/TextCell';
import { BadgesCell } from '@omniviewdev/ui/cells/BadgesCell';
import { ChipCell } from '@omniviewdev/ui/cells/ChipCell';

// --- Shared table wrapper ---

const cellTableStyles: React.CSSProperties = {
  borderCollapse: 'collapse',
  fontFamily: 'var(--ov-font-ui)',
  fontSize: 'var(--ov-text-sm)',
};

const cellThStyles: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 12px',
  fontWeight: 600,
  color: 'var(--ov-fg-muted)',
  borderBottom: '2px solid var(--ov-border-default)',
  whiteSpace: 'nowrap',
  width: 200,
};

const cellTdStyles: React.CSSProperties = {
  padding: '6px 12px',
  color: 'var(--ov-fg-default)',
  borderBottom: '1px solid var(--ov-border-muted)',
  height: 36,
  width: 200,
};

const labelTdStyles: React.CSSProperties = {
  ...cellTdStyles,
  fontFamily: 'var(--ov-font-mono)',
  fontSize: '12px',
  color: 'var(--ov-fg-muted)',
  width: 180,
};

function DemoTable({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <table style={cellTableStyles}>
      <thead>
        <tr>
          {headers.map((h) => (
            <th key={h} style={cellThStyles}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

// --- Helpers ---

function twoHoursAgo(): string {
  return new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
}

// --- Page ---

export default function CellsPage() {
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
        Table Cells
      </Typography>

      {/* ---- TextCell ---- */}
      <Section
        title="TextCell"
        description="Renders a text value inside a table cell. Supports built-in formatters (age, bytes, sum, count, avg, max, min), color mapping, and decorator elements."
      >
        <ImportStatement code="import { TextCell } from '@omniviewdev/ui/cells';" />

        <Example title="Plain text" description="Basic string rendering.">
          <DemoTable headers={['Example', 'Rendered']}>
            <tr>
              <td style={labelTdStyles}>Plain text</td>
              <td style={cellTdStyles}><TextCell value="my-configmap" /></td>
            </tr>
          </DemoTable>
        </Example>

        <Example title="Age formatter" description="Displays a human-readable time difference from an ISO date string. Updates in real-time.">
          <DemoTable headers={['Input', 'Rendered']}>
            <tr>
              <td style={labelTdStyles}>~2 hours ago</td>
              <td style={cellTdStyles}><TextCell value={twoHoursAgo()} formatter="age" /></td>
            </tr>
          </DemoTable>
        </Example>

        <Example title="Bytes formatter" description='Converts Kubernetes-style byte strings (e.g. "1536Mi") to a human-readable unit.'>
          <DemoTable headers={['Input', 'Rendered']}>
            <tr>
              <td style={labelTdStyles}>1536Mi</td>
              <td style={cellTdStyles}><TextCell value="1536Mi" formatter="bytes" /></td>
            </tr>
          </DemoTable>
        </Example>

        <Example title="Sum formatter" description="Sums an array of numbers.">
          <DemoTable headers={['Input', 'Rendered']}>
            <tr>
              <td style={labelTdStyles}>[1, 2, 3]</td>
              <td style={cellTdStyles}><TextCell value={[1, 2, 3]} formatter="sum" /></td>
            </tr>
          </DemoTable>
        </Example>

        <Example title="With color" description='Applies a semantic color to the text.'>
          <DemoTable headers={['Color', 'Rendered']}>
            <tr>
              <td style={labelTdStyles}>success</td>
              <td style={cellTdStyles}><TextCell value="Running" color="success" /></td>
            </tr>
            <tr>
              <td style={labelTdStyles}>warning</td>
              <td style={cellTdStyles}><TextCell value="Pending" color="warning" /></td>
            </tr>
            <tr>
              <td style={labelTdStyles}>danger</td>
              <td style={cellTdStyles}><TextCell value="CrashLoopBackOff" color="danger" /></td>
            </tr>
          </DemoTable>
        </Example>

        <PropsTable
          props={[
            { name: 'value', type: 'any', description: 'The value to render. Type depends on the formatter.' },
            { name: 'color', type: "'success' | 'warning' | 'danger' | 'primary' | 'neutral'", description: 'Semantic color applied to the text.' },
            { name: 'colorMap', type: 'Record<string, string>', description: 'Maps specific values to color names. Use "*" as a fallback key.' },
            { name: 'startDecorator', type: 'ReactNode', description: 'Element rendered before the text.' },
            { name: 'endDecorator', type: 'ReactNode', description: 'Element rendered after the text.' },
            { name: 'align', type: "'left' | 'right' | 'center'", default: "'left'", description: 'Horizontal alignment within the cell.' },
            { name: 'formatter', type: "'age' | 'bytes' | 'sum' | 'count' | 'avg' | 'max' | 'min'", description: 'Built-in formatter to apply to the value.' },
          ]}
        />
      </Section>

      {/* ---- BadgesCell ---- */}
      <Section
        title="BadgesCell"
        description="Renders a row of small colored badge dots, useful for showing container statuses or multi-value indicators at a glance."
      >
        <ImportStatement code="import { BadgesCell } from '@omniviewdev/ui/cells';" />

        <Example title="Single badge" description="A single status badge.">
          <DemoTable headers={['Example', 'Rendered']}>
            <tr>
              <td style={labelTdStyles}>Running</td>
              <td style={cellTdStyles}>
                <BadgesCell
                  values={['Running']}
                  colorMap={{ Running: 'success' }}
                />
              </td>
            </tr>
          </DemoTable>
        </Example>

        <Example title="Multiple badges with colorMap" description="Multiple container statuses shown as colored dots.">
          <DemoTable headers={['Values', 'Rendered']}>
            <tr>
              <td style={labelTdStyles}>Running, Pending, Error</td>
              <td style={cellTdStyles}>
                <BadgesCell
                  values={['Running', 'Pending', 'Error']}
                  colorMap={{ Running: 'success', Pending: 'warning', Error: 'danger' }}
                />
              </td>
            </tr>
            <tr>
              <td style={labelTdStyles}>Running x3</td>
              <td style={cellTdStyles}>
                <BadgesCell
                  values={['Running', 'Running', 'Running']}
                  colorMap={{ Running: 'success', Pending: 'warning', Error: 'danger' }}
                />
              </td>
            </tr>
          </DemoTable>
        </Example>

        <Example title="Alignment variations" description="Badges can be left, center, or right aligned.">
          <DemoTable headers={['Alignment', 'Rendered']}>
            <tr>
              <td style={labelTdStyles}>left (default)</td>
              <td style={cellTdStyles}>
                <BadgesCell
                  values={['Running', 'Pending']}
                  colorMap={{ Running: 'success', Pending: 'warning' }}
                  align="left"
                />
              </td>
            </tr>
            <tr>
              <td style={labelTdStyles}>center</td>
              <td style={cellTdStyles}>
                <BadgesCell
                  values={['Running', 'Pending']}
                  colorMap={{ Running: 'success', Pending: 'warning' }}
                  align="center"
                />
              </td>
            </tr>
            <tr>
              <td style={labelTdStyles}>right</td>
              <td style={cellTdStyles}>
                <BadgesCell
                  values={['Running', 'Pending']}
                  colorMap={{ Running: 'success', Pending: 'warning' }}
                  align="right"
                />
              </td>
            </tr>
          </DemoTable>
        </Example>

        <PropsTable
          props={[
            { name: 'values', type: 'string[]', description: 'Array of status values to render as badge dots.' },
            { name: 'colorMap', type: "Record<string, ColorName>", description: 'Maps each value to a semantic color (success, warning, danger, primary, neutral).' },
            { name: 'align', type: "'left' | 'right' | 'center' | 'justify'", default: "'left'", description: 'Horizontal alignment of the badge row.' },
            { name: 'hoverMenu', type: '(value: string) => ReactNode', description: 'Render function for a tooltip shown on hover over each badge.' },
            { name: 'hoverMenuDelay', type: 'number', default: '200', description: 'Delay in milliseconds before the hover tooltip appears.' },
          ]}
        />
      </Section>

      {/* ---- ChipCell ---- */}
      <Section
        title="ChipCell"
        description="Renders a Material UI Chip inside a table cell. Supports color mapping, icon decorators, and variant styling."
      >
        <ImportStatement code="import { ChipCell } from '@omniviewdev/ui/cells';" />

        <Example title="Basic chip" description="A simple chip with default styling.">
          <DemoTable headers={['Example', 'Rendered']}>
            <tr>
              <td style={labelTdStyles}>Default</td>
              <td style={cellTdStyles}><ChipCell value="default" /></td>
            </tr>
          </DemoTable>
        </Example>

        <Example title="With color" description="Direct color applied to the chip.">
          <DemoTable headers={['Color', 'Rendered']}>
            <tr>
              <td style={labelTdStyles}>success</td>
              <td style={cellTdStyles}><ChipCell value="Running" color="success" /></td>
            </tr>
            <tr>
              <td style={labelTdStyles}>warning</td>
              <td style={cellTdStyles}><ChipCell value="Pending" color="warning" /></td>
            </tr>
            <tr>
              <td style={labelTdStyles}>danger</td>
              <td style={cellTdStyles}><ChipCell value="Failed" color="danger" /></td>
            </tr>
          </DemoTable>
        </Example>

        <Example title="With colorMap" description="Automatic color selection based on the value.">
          <DemoTable headers={['Value', 'Rendered']}>
            <tr>
              <td style={labelTdStyles}>Running</td>
              <td style={cellTdStyles}>
                <ChipCell
                  value="Running"
                  colorMap={{ Running: 'success', Pending: 'warning', Failed: 'danger' }}
                />
              </td>
            </tr>
            <tr>
              <td style={labelTdStyles}>Pending</td>
              <td style={cellTdStyles}>
                <ChipCell
                  value="Pending"
                  colorMap={{ Running: 'success', Pending: 'warning', Failed: 'danger' }}
                />
              </td>
            </tr>
          </DemoTable>
        </Example>

        <Example title="With startDecorator icon" description='Pass an icon name string (e.g. "LuBox") to render an icon before the label.'>
          <DemoTable headers={['Example', 'Rendered']}>
            <tr>
              <td style={labelTdStyles}>LuBox icon</td>
              <td style={cellTdStyles}>
                <ChipCell value="my-pod" startDecorator="LuBox" color="primary" />
              </td>
            </tr>
          </DemoTable>
        </Example>

        <Example title="Outlined variant" description='Use variant="outlined" for a less prominent chip.'>
          <DemoTable headers={['Variant', 'Rendered']}>
            <tr>
              <td style={labelTdStyles}>soft (default)</td>
              <td style={cellTdStyles}><ChipCell value="Filled" color="success" /></td>
            </tr>
            <tr>
              <td style={labelTdStyles}>outlined</td>
              <td style={cellTdStyles}><ChipCell value="Outlined" color="success" variant="outlined" /></td>
            </tr>
          </DemoTable>
        </Example>

        <PropsTable
          props={[
            { name: 'value', type: 'string', description: 'The label text displayed in the chip.' },
            { name: 'color', type: "'success' | 'warning' | 'danger' | 'primary' | 'neutral'", description: 'Semantic color applied to the chip.' },
            { name: 'colorMap', type: 'Record<string, ColorName>', description: 'Maps specific values to color names for automatic coloring.' },
            { name: 'startDecorator', type: 'string | ReactNode', description: 'Icon name string (e.g. "LuBox") or ReactNode rendered before the label.' },
            { name: 'endDecorator', type: 'string | ReactNode', description: 'Icon name string or ReactNode rendered after the label.' },
            { name: 'align', type: "'left' | 'right' | 'center'", default: "'left'", description: 'Horizontal alignment of the chip within the cell.' },
            { name: 'variant', type: "'soft' | 'outlined'", default: "'soft'", description: 'Visual variant of the chip. "soft" maps to filled, "outlined" to outlined.' },
          ]}
        />
      </Section>
    </Box>
  );
}
