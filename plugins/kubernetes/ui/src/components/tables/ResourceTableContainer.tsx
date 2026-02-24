import React, { useState } from 'react';

// @omniviewdev/ui
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import LinearProgress from '@mui/material/LinearProgress';
import Skeleton from '@mui/material/Skeleton';
import { Alert } from '@omniviewdev/ui/feedback';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { Heading } from '@omniviewdev/ui/typography';

import { ArrowDropDown } from '@mui/icons-material';

// Tanstack/react-table
import {
  type ColumnDef,
  type ColumnFiltersState,
  type FilterFn,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type RowSelectionState,
} from '@tanstack/react-table';
import get from 'lodash.get';

// Project imports
import MemoizedRow from './MemoizedRow';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useResources, InformerResourceState } from '@omniviewdev/runtime';
import { LuCircleAlert } from 'react-icons/lu';

export type Memoizer = string | string[] | ((data: any) => string);
export type IdAccessor = string | ((data: any) => string);

export type Props = {
  columns: Array<ColumnDef<any>>;
  namespaces?: string[];
  initialColumnVisibility?: VisibilityState;
  idAccessor: IdAccessor;
  namespaceAccessor?: string;
  memoizer?: Memoizer;
  pluginID: string;
  connectionID: string;
  resourceKey: string;
  search?: string;
};

const idAccessorResolver = (data: any, accessor: IdAccessor): string => {
  switch (typeof accessor) {
    case 'function':
      return accessor(data);
    case 'string':
      return get(data, accessor);
    default:
      throw new Error('Invalid ID accessor');
  }
};

export const namespaceFilter: FilterFn<any> = (row, columnId, value: string[]) => {
  if (!value?.length) {
    return true;
  }

  return value.includes(row.getValue(columnId));
};


const ResourceTableContainer: React.FC<Props> = ({
  columns,
  idAccessor,
  namespaceAccessor,
  memoizer,
  pluginID,
  connectionID,
  resourceKey,
  initialColumnVisibility,
  search,
}) => {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([{ id: 'namespace', value: [] }]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  React.useLayoutEffect(() => {
    const storedColumnVisibility = window.localStorage.getItem(`${pluginID}-${connectionID}-${resourceKey}-column-visibility`);
    if (storedColumnVisibility && initialColumnVisibility) {
      const current = JSON.parse(storedColumnVisibility);

      Object.entries(initialColumnVisibility).forEach(([key, value]) => {
        if (!current.hasOwnProperty(key)) {
          current[key] = value;
        }
      });

      setColumnVisibility(current);
    } else if (initialColumnVisibility) {
      setColumnVisibility(initialColumnVisibility);
    }
  }, [initialColumnVisibility]);

  React.useEffect(() => {
    let visibility = JSON.stringify(columnVisibility);
    if (visibility !== '{}') {
      window.localStorage.setItem(`${pluginID}-${connectionID}-${resourceKey}-column-visibility`, visibility);
    }
  }, [columnVisibility]);

  const { resources, informerState, isSyncing } = useResources({ pluginID, connectionID, resourceKey });

  const table = useReactTable({
    data: resources.data?.result || [],
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    getRowId: (row) => idAccessorResolver(row, idAccessor),
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      globalFilter: search,
    },
    defaultColumn: {
      minSize: 0,
      size: Number.MAX_SAFE_INTEGER,
      maxSize: Number.MAX_SAFE_INTEGER,
    },
  });

  const { rows } = table.getRowModel();

  const parentRef = React.useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: React.useCallback(() => 36, []),
    overscan: 10,
  });

  // Derive loading states from informer
  const isInitialLoad = !resources.data && !resources.isError;
  const showSkeleton = isInitialLoad || informerState === InformerResourceState.Pending;
  const showSyncingOverlay = isSyncing && (resources.data?.result?.length ?? 0) === 0;
  const showSyncingIndicator = isSyncing && (resources.data?.result?.length ?? 0) > 0;

  // Skeleton / syncing overlay states
  if (showSkeleton) {
    return (
      <Box
        sx={{
          backgroundColor: 'inherit',
          width: '100%',
          borderRadius: '4px',
          flex: 1,
          minHeight: 0,
          border: '1px solid',
          borderColor: 'divider',
          overflow: 'hidden',
        }}
      >
        <table style={{ display: 'grid', width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ display: 'grid', position: 'sticky', top: 0, zIndex: 1 }}>
            <tr style={{ display: 'flex', width: '100%' }}>
              {columns.slice(0, 5).map((_, i) => (
                <th key={i} style={{ flex: 1, padding: '8px 12px' }}>
                  <Skeleton variant="text" width="60%" sx={{ fontSize: '0.75rem' }} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody style={{ display: 'grid' }}>
            {Array.from({ length: 8 }).map((_, i) => (
              <tr key={i} style={{ display: 'flex', width: '100%', height: 36, opacity: 1 - i * 0.08 }}>
                {columns.slice(0, 5).map((_, j) => (
                  <td key={j} style={{ flex: 1, padding: '6px 12px', display: 'flex', alignItems: 'center' }}>
                    <Skeleton variant="text" width={`${50 + Math.random() * 40}%`} sx={{ fontSize: '0.75rem' }} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
    );
  }

  if (showSyncingOverlay) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          width: '100%',
          gap: 2,
        }}
      >
        <CircularProgress size={32} thickness={4} sx={{ color: 'var(--ov-accent-fg, #58a6ff)' }} />
        <Text size="sm" sx={{ color: 'var(--ov-fg-muted)' }}>
          Syncing {resourceKey.split('::').pop()}...
        </Text>
        <LinearProgress
          variant="indeterminate"
          sx={{
            width: 200,
            height: 3,
            borderRadius: 1.5,
            bgcolor: 'rgba(255,255,255,0.08)',
            '& .MuiLinearProgress-bar': {
              bgcolor: 'var(--ov-accent-fg, #58a6ff)',
              borderRadius: 1.5,
            },
          }}
        />
      </Box>
    );
  }

  if (resources.isError) {
    const errstring = resources.error?.toString() ?? '';
    console.error('Failed loading resources', errstring);

    let title = 'Failed to load resources';
    let detail = errstring;
    let suggestions: string[] = [];

    if (errstring.includes('could not find the requested resource')) {
      title = 'Resource group not found';
      detail = 'The requested resource type could not be found on this cluster.';
      suggestions = [
        'The resource group may not exist on this cluster',
        'The API group may have been removed or is not installed',
        'You may not have permission to discover this API group',
      ];
    } else if (errstring.includes('forbidden') || errstring.includes('Forbidden') || errstring.includes('403')) {
      title = 'Access denied';
      detail = 'You do not have permission to access this resource.';
      suggestions = [
        'Check your RBAC permissions for this resource type',
        'Contact your cluster administrator for access',
        'Verify your kubeconfig context is correct',
      ];
    } else if (errstring.includes('connection refused') || errstring.includes('no such host') || errstring.includes('network') || errstring.includes('timeout') || errstring.includes('ETIMEDOUT') || errstring.includes('ECONNREFUSED')) {
      title = 'Connection error';
      detail = 'Unable to reach the cluster API server.';
      suggestions = [
        'Check that the cluster is running and reachable',
        'Verify your network connection',
        'Check if a VPN or proxy is required',
      ];
    } else if (errstring.includes('certificate') || errstring.includes('x509') || errstring.includes('TLS')) {
      title = 'Certificate error';
      detail = 'There was a TLS/certificate issue connecting to the cluster.';
      suggestions = [
        'The cluster certificate may have expired',
        'Your kubeconfig may reference outdated certificates',
        'Check if the CA bundle is configured correctly',
      ];
    } else if (errstring.includes('unauthorized') || errstring.includes('Unauthorized') || errstring.includes('401')) {
      title = 'Authentication failed';
      detail = 'Your credentials were rejected by the cluster.';
      suggestions = [
        'Your auth token may have expired — try re-authenticating',
        'Check your kubeconfig credentials',
        'If using OIDC, try refreshing your login',
      ];
    }

    return (
      <Box
        sx={{
          display: 'flex',
          gap: 2,
          justifyContent: 'center',
          flexDirection: 'column',
          alignItems: 'center',
          height: '100%',
          width: '100%',
          userSelect: 'none',
        }}>
        <Alert
          emphasis='soft'
          size='lg'
          startAdornment={<LuCircleAlert size={20} />}
          color='danger'
        >
          <Heading level='h4' sx={{ color: 'danger.main' }}>
            {title}
          </Heading>
        </Alert>
        <Stack direction="column" spacing={1} sx={{ maxWidth: 560, textAlign: 'center' }}>
          <Text size='sm' sx={{ color: 'text.secondary' }}>
            {detail}
          </Text>
          {suggestions.length > 0 && (
            <Box component="ul" sx={{ textAlign: 'left', pl: 2, m: 0 }}>
              {suggestions.map((s) => (
                <Box component="li" key={s} sx={{ py: 0.25 }}>
                  <Text size='xs' sx={{ color: 'text.secondary' }}>{s}</Text>
                </Box>
              ))}
            </Box>
          )}
          <Text
            size='xs'
            sx={{
              color: 'text.disabled',
              fontFamily: 'monospace',
              mt: 1,
              p: 1,
              borderRadius: 1,
              bgcolor: 'action.hover',
              wordBreak: 'break-all',
              maxHeight: 80,
              overflow: 'auto',
            }}
          >
            {resourceKey}: {errstring || 'Unknown error'}
          </Text>
        </Stack>
      </Box>
    );
  }

  return (
    <Box
      className={'table-container'}
      ref={parentRef}
      sx={{
        backgroundColor: 'inherit',
        width: '100%',
        borderRadius: '4px',
        flex: 1,
        overflow: 'scroll',
        minHeight: 0,
        border: '1px solid',
        borderColor: 'divider',
        position: 'relative',
        '&::-webkit-scrollbar': {
          display: 'none',
        },
        scrollbarWidth: 'none',
        WebkitUserSelect: 'none',
        opacity: showSyncingIndicator ? 0.85 : 1,
        transition: 'opacity 0.2s ease',
      }}
    >
      {showSyncingIndicator && (
        <LinearProgress
          variant="indeterminate"
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            zIndex: 2,
            bgcolor: 'transparent',
            '& .MuiLinearProgress-bar': {
              bgcolor: 'var(--ov-accent-fg, #58a6ff)',
            },
          }}
        />
      )}
      <table
        aria-labelledby={'table-title'}
        style={{
          display: 'grid',
          width: '100%',
          borderCollapse: 'collapse',
          WebkitUserSelect: 'none',
        }}
      >
        <thead
          style={{
            display: 'grid',
            position: 'sticky',
            top: 0,
            zIndex: 1,
          }}
        >
          {table.getHeaderGroups().map(headerGroup => (
            <tr
              key={headerGroup.id}
              style={{ display: 'flex', width: '100%', cursor: 'pointer' }}
            >
              {headerGroup.headers.map(header => (
                <th
                  key={header.id}
                  style={{
                    alignContent: 'center',
                    display: 'flex',
                    alignItems: 'center',
                    width: header.getSize() === Number.MAX_SAFE_INTEGER ? 'auto' : header.getSize(),
                    minWidth: header.getSize() === Number.MAX_SAFE_INTEGER ? 'auto' : header.getSize(),
                    maxWidth: header.getSize() === Number.MAX_SAFE_INTEGER ? 'auto' : header.getSize(),
                    flex: 1,
                  }}
                >
                  {header.column.getCanSort()
                    ? <Box
                      component='button'
                      onClick={header.column.getToggleSortingHandler()}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'primary.main',
                        fontWeight: 'bold',
                        p: 0,
                        '& svg': {
                          transition: '0.2s',
                          transform:
                            header.column.getIsSorted() as string === 'desc' ? 'rotate(180deg)' : 'rotate(0deg)',
                        },
                      }}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getIsSorted() && <ArrowDropDown />}
                    </Box>
                    : flexRender(header.column.columnDef.header, header.getContext())
                  }
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody
          style={{
            display: 'grid',
            height: `${virtualizer.getTotalSize()}px`,
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map(virtualRow => {
            const row = rows[virtualRow.index];
            return (
              <MemoizedRow
                key={row.id}
                pluginID={pluginID}
                connectionID={connectionID}
                resourceID={row.id}
                resourceKey={resourceKey}
                namespace={namespaceAccessor ? get(row.original, namespaceAccessor) : undefined}
                row={row}
                memoizer={memoizer}
                virtualizer={virtualizer}
                virtualRow={virtualRow}
                isSelected={rowSelection[row.id]}
                columnVisibility={JSON.stringify(columnVisibility)}
              />
            );
          })}
        </tbody>
      </table>
    </Box>
  );
};

ResourceTableContainer.displayName = 'ResourceTableContainer';
ResourceTableContainer.whyDidYouRender = true;

export default ResourceTableContainer;
