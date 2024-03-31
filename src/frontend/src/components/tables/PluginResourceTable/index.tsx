import React, { useState, useMemo } from 'react';

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
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';

// Project imports
import NamespaceSelect from '@/components/selects/NamespaceSelect';
import { useResources } from '@/hooks/resource/useResources';
import { DebouncedInput } from './DebouncedInput';
import { MemoizedRow } from './MemoizedRow';
import { Alert, CircularProgress } from '@mui/joy';
import { LuAlertCircle } from 'react-icons/lu';

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

export const namespaceFilter: FilterFn<any> = (row, columnId, value: string[]) => {
  // If not selected namespaces, return true
  if (!value?.length) {
    return true;
  }

  return value.includes(row.getValue(columnId));
};

/**
  * Render a generic resource table with sorting, filtering, column visibility and row selection.
  * Use this component to display a generic table for any Kubernetes resource using tanstack/react-table.
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
  const [rowSelection, setRowSelection] = useState({});

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
    getRowId: row => row.metadata?.uid ? row.metadata.uid as string : Math.random().toString(36).substring(7),
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

  if (resources.isLoading) {
    return (
      <Box sx={{
        display: 'flex',
        gap: 4,
        justifyContent: 'center',
        flexDirection: 'column',
        alignItems: 'center',
        height: '100%',
        width: '100%',
        userSelect: 'none',
        animation: 'fadeIn 0.2s ease-in-out',
        '@keyframes fadeIn': {
          '0%': {
            opacity: 0,
            scale: 0.3,
          },
          '100%': {
            opacity: 1,
            scale: 1,
          },
        },
      }}>
        <CircularProgress size={'lg'} thickness={8} />
        <Typography level='title-lg'>
          Loading {resourceKey} resources...
        </Typography>
      </Box>
    );
  }

  if (resources.isError) {
    let errstring = resources.error.toString();
    console.error('Failed loading resources', errstring);
    let error = <p>{'An error occurred while loading resources'}</p>;
    if (errstring.includes('could not find the requested resource')) {
      error = <div>
        <span>{'The resource group could not be found. This may be the result of'}</span>
        <ol>
          <li>{'The resource group does not exist (for this connection)'}</li>
          <li>{'The resource group has been deleted (for this connection)'}</li>
          <li>{'You do not have permission to access the resource group'}</li>
        </ol>
      </div>;
    }

    return (
      <Box sx={{
        display: 'flex',
        gap: 4,
        justifyContent: 'center',
        flexDirection: 'column',
        alignItems: 'center',
        height: '100%',
        width: '100%',
        userSelect: 'none',
      }}>
        <Alert
          variant='soft'
          size='lg'
          startDecorator={<LuAlertCircle size={20} />}
          color='danger'
        >
          <Typography level='title-lg' color='danger'>
            Failed loading {resourceKey} resources
          </Typography>
        </Alert>
        <Typography level='body-sm' color='danger' textAlign={'center'} maxWidth={500} flexWrap='wrap'>
          {error}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column', p: 1, gap: 1, minHeight: 0 }} >
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
        sx={{
          width: '100%',
          borderRadius: 'sm',
          flex: 1,
          overflow: 'scroll',
          minHeight: 0, 
          // TODO: make this a prop
          // Hide the scrollbars
          '&::-webkit-scrollbar': {
            display: 'none',
          },
          scrollbarWidth: 'none',
          WebkitUserSelect: 'none',
        }}
      >
        <Table
          aria-labelledby={'table-title'}
          stickyHeader
          hoverRow
          sx={{
            '--TableCell-headBackground':
              'var(--joy-palette-background-level1)',
            '--Table-headerUnderlineThickness': '1px',
            '--TableRow-hoverBackground':
              'var(--joy-palette-background-level1)',
            '--TableCell-paddingY': '2px',
            '--TableCell-paddingX': '8px',
            WebkitUserSelect: 'none',
          }}
        >
          <thead>
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id} style={{ cursor: 'pointer' }}>
                {headerGroup.headers.map(header => (
                  <th key={header.id} style={{
                    alignContent: 'center', paddingTop: '12px', paddingBottom: '12px', width: header.getSize() === Number.MAX_SAFE_INTEGER ? 'auto' : header.getSize(),
                  }} >
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
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <MemoizedRow key={row.original.metadata?.uid as string} pluginID={pluginID} connectionID={connectionID} row={row} kind={resourceKey} />
            ))}
          </tbody>
        </Table>
      </Sheet>
    </Box>
  );
};

PluginResourceTable.displayName = 'PluginResourceTable';
PluginResourceTable.whyDidYouRender = true;

export default PluginResourceTable;
