import { useState, useRef, useMemo } from 'react';

// Material-ui
import Box from '@mui/joy/Box';
import Typography from '@mui/joy/Typography';
import Link from '@mui/joy/Link';
import Sheet from '@mui/joy/Sheet';
import Table from '@mui/joy/Table';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import Stack from '@mui/joy/Stack';

// Tanstack/react-table
import {
  type ColumnDef,
  type ColumnFiltersState,
  type FilterFn,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';

// Project imports
import NamespaceSelect from '@/components/selects/NamespaceSelect';
import { useResources } from '@/hooks/resource/useResources';
import { DebouncedInput } from './DebouncedInput';
import RowComponent from './RowComponent';
import Resizer from './Resizer';

export type Props = {
  /**
   * Column defenition for the table.
   */
  columns: Array<ColumnDef<any>>;

  /**
   * ID for the plugin.
   */
  pluginID: string;

  /**
  * ID for the connection.
  */
  connectionID: string;

  /**
   * The resource key that uniquely identifies the resource.
   */
  resourceKey: string;
};

export const namespaceFilter: FilterFn<any> = (row, columnId, value) => {
  // If not selected namespaces, return true
  if (!value?.length) {
    return true;
  }

  return value.includes(row.getValue(columnId));
};

/**
  * Render a generic resource table with sorting, filtering, column visibility and row selection.
  * Use this component to display a generic table for any Kubernetes resource using tanstack/react-table.
  * This is a work in progress as the virtualization is not working perfectly as expected
  *
  * @param columns - The columns to display in the table.
  * @param data - The data to display in the table.
  * @returns The resource table.
  */
const PluginResourceTable: React.FC<Props> = ({ columns, pluginID, connectionID, resourceKey }) => {
  // Monkey patch the namespace column so it uses the namespace filter
  const namespaced = columns.some(c => c.id === 'namespace');
  if (namespaced) {
    columns.find(c => c.id === 'namespace')!.filterFn = namespaceFilter;
  }

  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(namespaced ? [
    { id: 'namespace', value: [] },
  ] : []);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const setNamespaces = (namespaces: string[]) => {
    setColumnFilters(prev => {
      const namespaceFilter = prev.find(f => f.id === 'namespace');
      if (namespaceFilter) {
        return prev.map(f => {
          if (f.id === 'namespace') {
            return { ...f, value: namespaces };
          }

          return f;
        });
      }

      return prev;
    });
  };

  const [search, setSearch] = useState<string>('');

  const { resources } = useResources({ pluginID, connectionID, resourceKey });

  const data = useMemo(() =>
  // Assuming resources.data is the data you're getting from useResources
  // Transform it into an array if it's not undefined, otherwise default to an empty array
    resources.data?.result ? Object.values(resources.data.result) : []
  , [resources.data?.result]);

  const table = useReactTable({
    data,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    // GetPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    // The object will always have a metadata.uid, so we can use that as the row id,
    // that last part is just to avoid the type error
    getRowId: row => row.metadata?.uid ? row.metadata.uid : 'error',
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

  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    // TODO - tried to get this working but couldn't
    // getItemKey: useCallback((index: number) => rows[index]?.id ?? index, [rows]),
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40, // Estimate row height for accurate scrollbar dragging
    // getItemKey: useCallback((index: number) => rows[index]?.id ?? index, [rows]),
    overscan: 40,
    // Measure dynamic row height, except in firefox because it measures table border height incorrectly
    measureElement:
      typeof window !== 'undefined'
        && !navigator.userAgent.includes('Firefox')
      	? element => element?.getBoundingClientRect().height
      	: undefined,
  });

  if (resources.isLoading) {
    return (
      <Box sx={{
        display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', width: '100%',
      }}>
        <Typography level='h2'>
          Loading {resourceKey}...
        </Typography>
      </Box>
    );
  }

  if (resources.isError) {
    console.log(resources.error);
    return (
      <Box sx={{
        display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', width: '100%',
      }}>
        <Typography level='h2' color='danger'>
          Error loading {resourceKey}
        </Typography>
      </Box>
    );
  }

  return (
    <>
      <Stack direction='row' justifyContent={'space-between'} className='NamespaceAndSearch' sx={{ width: '100%' }}>
        <DebouncedInput
          value={search ?? ''}
          onChange={value => {
            setSearch(String(value));
          }}
          placeholder='Search all columns...'
        />
        {namespaced && <NamespaceSelect namespaces={columnFilters.find(f => f.id === 'namespace')?.value as string[] || []} setNamespaces={setNamespaces} />}
      </Stack>
      <Sheet
        className={'table-container'}
        variant='outlined'
        ref={parentRef}
        sx={{
          display: { xs: 'none', sm: 'initial' },
          width: '100%',
          borderRadius: 'sm',
          flexShrink: 1,
          flexGrow: 1,
          overflow: 'auto',
          position: 'relative',
          height: 'calc(100dvh - var(--CoreLayoutHeader-height) - var(--LowerContextMenu-height) - 36px)',
        }}
      >
        <Table
          aria-labelledby={'table-title'}
          stickyHeader
          hoverRow
          sx={{
            display: 'grid',
            '--TableCell-headBackground':
              'var(--joy-palette-background-level1)',
            '--Table-headerUnderlineThickness': '1px',
            '--TableRow-hoverBackground':
              'var(--joy-palette-background-level1)',
            '--TableCell-paddingY': '2px',
            '--TableCell-paddingX': '8px',
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
                style={{ display: 'flex', width: '100%' }}
              >
                {headerGroup.headers.map(header => {
                  const width = header.getSize() === Number.MAX_SAFE_INTEGER ? 'auto' : header.getSize();
                  return (
                    <th
                      key={header.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        maxWidth: width,
                        minWidth: width,
                        flexGrow: 1,
                      }}
                    >
                      {header.column.getCanSort()
                        ? <Link
                          underline='none'
                          color='primary'
                          component='button'
                          onClick={header.column.getToggleSortingHandler()}
                          fontWeight='lg'
                          endDecorator={header.column.getIsSorted() && <ArrowDropDownIcon />}
                          sx={{
                            '& svg': {
                              transition: '0.2s',
                              transform:
                                header.column.getIsSorted() as string === 'desc' ? 'rotate(180deg)' : 'rotate(0deg)',
                            },
                          }}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                        </Link>
                        : flexRender(header.column.columnDef.header, header.getContext())
                      }

                      <Resizer header={header} table={table} />
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody
            style={{
              display: 'grid',
              height: `${virtualizer.getTotalSize()}px`, // Tells scrollbar how big the table is
              position: 'relative', // Needed for absolute positioning of rows
            }}
          >
            {virtualizer.getVirtualItems().map(virtualRow => {
              const row = rows[virtualRow.index];
              return (
                <RowComponent
                  key={row.id}
                  /* @ts-expect-error - stop warning about an lsp error that's not true... */
                  virtualizer={virtualizer}
                  virtualRow={virtualRow}
                  row={row}
                  resourceKey={resourceKey}
                  isSelected={Boolean(rowSelection[row.id])}
                  uniquers={['metadata.uid', 'metadata.resourceVersion']}
                />
              );
            })}
          </tbody>
        </Table>
      </Sheet>
    </>
  );
};

PluginResourceTable.displayName = 'PluginResourceTable';
PluginResourceTable.whyDidYouRender = true;

export default PluginResourceTable;
