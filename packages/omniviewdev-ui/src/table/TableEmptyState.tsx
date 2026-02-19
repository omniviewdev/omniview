import TableRow from '@mui/material/TableRow';
import TableCell from '@mui/material/TableCell';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

export interface TableEmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  colSpan: number;
}

export default function TableEmptyState({
  icon,
  title,
  description,
  action,
  colSpan,
}: TableEmptyStateProps) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} sx={{ textAlign: 'center', py: 6, border: 0 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}>
          {icon && (
            <Box sx={{ color: 'var(--ov-fg-faint)', fontSize: 40 }}>
              {icon}
            </Box>
          )}
          <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'var(--ov-fg-base)' }}>
            {title}
          </Typography>
          {description && (
            <Typography variant="body2" sx={{ color: 'var(--ov-fg-muted)', maxWidth: 360 }}>
              {description}
            </Typography>
          )}
          {action && <Box sx={{ mt: 1 }}>{action}</Box>}
        </Box>
      </TableCell>
    </TableRow>
  );
}

TableEmptyState.displayName = 'TableEmptyState';
