import type { ReactNode } from 'react';
import Box from '@mui/material/Box';

interface VariantMatrixProps<R extends string, C extends string> {
  rows: R[];
  columns: C[];
  rowLabel?: string;
  columnLabel?: string;
  renderCell: (row: R, column: C) => ReactNode;
}

/**
 * Generic grid renderer for showing all combinations of two variant axes
 * (typically color x emphasis). Used in showcase pages.
 */
export default function VariantMatrix<R extends string, C extends string>({
  rows,
  columns,
  rowLabel = 'Row',
  columnLabel = 'Column',
  renderCell,
}: VariantMatrixProps<R, C>) {
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box
        component="table"
        sx={{
          borderCollapse: 'collapse',
          width: '100%',
          '& td, & th': {
            padding: '8px 12px',
            textAlign: 'center',
            verticalAlign: 'middle',
          },
        }}
      >
        <thead>
          <tr>
            <Box
              component="th"
              sx={{
                textAlign: 'left',
                fontSize: 'var(--ov-text-xs)',
                color: 'var(--ov-fg-faint)',
                fontWeight: 600,
              }}
            >
              {rowLabel} \ {columnLabel}
            </Box>
            {columns.map((col) => (
              <Box
                component="th"
                key={col}
                sx={{
                  fontSize: 'var(--ov-text-xs)',
                  color: 'var(--ov-fg-muted)',
                  fontWeight: 600,
                  textTransform: 'capitalize',
                }}
              >
                {col}
              </Box>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row}>
              <Box
                component="td"
                sx={{
                  textAlign: 'left',
                  fontFamily: 'var(--ov-font-mono)',
                  fontSize: 'var(--ov-text-xs)',
                  color: 'var(--ov-fg-muted)',
                  whiteSpace: 'nowrap',
                }}
              >
                {row}
              </Box>
              {columns.map((col) => (
                <td key={col}>{renderCell(row, col)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </Box>
    </Box>
  );
}

export type { VariantMatrixProps };
