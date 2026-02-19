import MuiTable from '@mui/material/Table';
import TableHead from '@mui/material/TableHead';
import TableBody from '@mui/material/TableBody';
import TableRow from '@mui/material/TableRow';
import TableCell from '@mui/material/TableCell';

import type { Density } from '../types';
import { Skeleton } from '../feedback';

export interface TableSkeletonProps {
  columns: number;
  rows?: number;
  density?: Density;
}

const densityPadding: Record<string, number> = {
  compact: 0.25,
  comfortable: 1,
  spacious: 2,
};

export default function TableSkeleton({
  columns,
  rows = 5,
  density = 'comfortable',
}: TableSkeletonProps) {
  const py = densityPadding[density] ?? 1;

  return (
    <MuiTable size="small">
      <TableHead>
        <TableRow>
          {Array.from({ length: columns }).map((_, i) => (
            <TableCell key={i} sx={{ py, fontWeight: 600 }}>
              <Skeleton variant="text" width="60%" />
            </TableCell>
          ))}
        </TableRow>
      </TableHead>
      <TableBody>
        {Array.from({ length: rows }).map((_, ri) => (
          <TableRow key={ri}>
            {Array.from({ length: columns }).map((_, ci) => (
              <TableCell key={ci} sx={{ py }}>
                <Skeleton variant="text" width={`${50 + Math.random() * 40}%`} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </MuiTable>
  );
}

TableSkeleton.displayName = 'TableSkeleton';
