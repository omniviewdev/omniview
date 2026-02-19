import { Box } from '@mui/material';

interface PropDef {
  name: string;
  type: string;
  default?: string;
  description: string;
}

interface PropsTableProps {
  props: PropDef[];
}

/**
 * Renders a plain HTML table documenting component props. Uses design tokens
 * directly for maximum simplicity and to avoid heavy MUI Table overhead.
 */
export default function PropsTable({ props }: PropsTableProps) {
  return (
    <Box sx={{ overflowX: 'auto', mt: '8px' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 'var(--ov-text-sm)',
          fontFamily: 'var(--ov-font-ui)',
        }}
      >
        <thead>
          <tr>
            {['Name', 'Type', 'Default', 'Description'].map((heading) => (
              <th
                key={heading}
                style={{
                  textAlign: 'left',
                  padding: '8px 12px',
                  fontWeight: 600,
                  color: 'var(--ov-fg-muted)',
                  borderBottom: '2px solid var(--ov-border-default)',
                  whiteSpace: 'nowrap',
                }}
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.map((prop) => (
            <tr key={prop.name}>
              <td
                style={{
                  padding: '8px 12px',
                  fontFamily: 'var(--ov-font-mono)',
                  fontWeight: 600,
                  color: 'var(--ov-fg-base)',
                  borderBottom: '1px solid var(--ov-border-muted)',
                  whiteSpace: 'nowrap',
                }}
              >
                {prop.name}
              </td>
              <td
                style={{
                  padding: '8px 12px',
                  fontFamily: 'var(--ov-font-mono)',
                  color: 'var(--ov-fg-muted)',
                  borderBottom: '1px solid var(--ov-border-muted)',
                  whiteSpace: 'nowrap',
                }}
              >
                {prop.type}
              </td>
              <td
                style={{
                  padding: '8px 12px',
                  fontFamily: 'var(--ov-font-mono)',
                  color: prop.default ? 'var(--ov-fg-default)' : 'var(--ov-fg-faint)',
                  borderBottom: '1px solid var(--ov-border-muted)',
                  whiteSpace: 'nowrap',
                }}
              >
                {prop.default ?? '\u2014'}
              </td>
              <td
                style={{
                  padding: '8px 12px',
                  color: 'var(--ov-fg-default)',
                  borderBottom: '1px solid var(--ov-border-muted)',
                }}
              >
                {prop.description}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Box>
  );
}

export type { PropDef, PropsTableProps };
