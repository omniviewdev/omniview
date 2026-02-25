import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

export interface AIResourceTableColumn {
  key: string;
  label: string;
  render?: (value: any, row: Record<string, any>) => React.ReactNode;
  width?: string | number;
}

export interface AIResourceTableProps {
  rows: Array<Record<string, any>>;
  columns: AIResourceTableColumn[];
  title?: string;
  onRowClick?: (row: Record<string, any>) => void;
  sx?: SxProps<Theme>;
}

export default function AIResourceTable({
  rows,
  columns,
  title,
  onRowClick,
  sx,
}: AIResourceTableProps) {
  return (
    <Box
      sx={{
        borderRadius: '6px',
        border: '1px solid var(--ov-border-default)',
        bgcolor: 'var(--ov-bg-surface)',
        overflow: 'hidden',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {title && (
        <Box
          sx={{
            px: 1.5,
            py: 0.75,
            borderBottom: '1px solid var(--ov-border-default)',
          }}
        >
          <Typography
            sx={{
              fontSize: 'var(--ov-text-xs)',
              fontWeight: 'var(--ov-weight-semibold)',
              color: 'var(--ov-fg-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            {title}
          </Typography>
        </Box>
      )}

      <Box sx={{ overflow: 'auto' }}>
        <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse' }}>
          {/* Header */}
          <Box component="thead">
            <Box component="tr">
              {columns.map((col) => (
                <Box
                  key={col.key}
                  component="th"
                  sx={{
                    px: 1.5,
                    py: 0.5,
                    textAlign: 'left',
                    fontSize: 'var(--ov-text-xs)',
                    fontWeight: 'var(--ov-weight-semibold)',
                    color: 'var(--ov-fg-faint)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.03em',
                    borderBottom: '1px solid var(--ov-border-default)',
                    bgcolor: 'var(--ov-bg-surface-inset)',
                    width: col.width,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {col.label}
                </Box>
              ))}
            </Box>
          </Box>

          {/* Body */}
          <Box component="tbody">
            {rows.map((row, i) => (
              <Box
                key={i}
                component="tr"
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                sx={{
                  cursor: onRowClick ? 'pointer' : 'default',
                  '&:hover': { bgcolor: 'var(--ov-state-hover)' },
                  borderBottom:
                    i < rows.length - 1
                      ? '1px solid var(--ov-border-muted)'
                      : 'none',
                }}
              >
                {columns.map((col) => (
                  <Box
                    key={col.key}
                    component="td"
                    sx={{
                      px: 1.5,
                      py: 0.5,
                      fontSize: 'var(--ov-text-xs)',
                      color: 'var(--ov-fg-default)',
                      fontFamily: 'var(--ov-font-mono)',
                      verticalAlign: 'middle',
                    }}
                  >
                    {col.render
                      ? col.render(row[col.key], row)
                      : String(row[col.key] ?? '')}
                  </Box>
                ))}
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

AIResourceTable.displayName = 'AIResourceTable';
