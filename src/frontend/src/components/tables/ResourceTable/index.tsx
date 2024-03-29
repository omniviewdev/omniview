import { memo, useState, useEffect } from 'react';

// Material-ui
import Box from '@mui/joy/Box';
import Link from '@mui/joy/Link';
import Sheet from '@mui/joy/Sheet';
import Table from '@mui/joy/Table';
import Typography from '@mui/joy/Typography';
import Input, { type InputProps } from '@mui/joy/Input';
import Stack from '@mui/joy/Stack';
import IconButton from '@mui/joy/IconButton';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';

// Tanstack/react-table
import {
  type ColumnDef,
  type ColumnFiltersState,
  type FilterFn,
  type Row,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  // GetPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { type ObjectMeta } from 'kubernetes-types/meta/v1';
import NamespaceSelect from '@/components/selects/NamespaceSelect';
import { type Options, type UseKubernetesResult } from '@/hooks/useKubernetes';

/**
 * This table is specifically designed for handling Kubernetes resources. As such, we want
 * to ensure that the table is able to index on the metadata
 */
export type KubernetesResource = {
  apiVersion?: string;
  kind?: string;
  metadata?: ObjectMeta;
};

export type Props<T extends KubernetesResource> = {
  columns: Array<ColumnDef<T>>;
  kind: string;
  loader: (options: Options) => UseKubernetesResult<T>;
  clusters?: string[];
};

export type MemoizedRowProps<T extends KubernetesResource> = {
  row: Row<T>;
  kind: string;
};

/**
* Since we're using Kubernetes objects here which have some fields to help us identify
* whether or not the data has changed, we can use memoization checks to avoid
* unnecessary re-renders.
*/
export const MemoizedRow = memo(({ row }: MemoizedRowProps<KubernetesResource>) => {

  // Simplified memoization check can be done outside, based on your needs
  return (
    <tr>
      {row.getVisibleCells().map(cell => (
        <td
          key={cell.id}
          style={{
            width: cell.column.getSize() === Number.MAX_SAFE_INTEGER ? 'auto' : cell.column.getSize(),
            textOverflow: 'ellipsis',
            overflow: 'hidden',
          }}
        >
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </td>
      ))}
    </tr>
  );
}, (prevProps, nextProps) =>
// Example memoization condition, adjust according to your actual needs
  prevProps.row.original.metadata?.uid === nextProps.row.original.metadata?.uid
    && prevProps.row.original.metadata?.resourceVersion === nextProps.row.original.metadata?.resourceVersion,
);

MemoizedRow.displayName = 'MemoizedRow';

export type DebounceProps = {
  value: string;
  onChange: (value: string) => void;
  debounce?: number;
};

// A debounced input react component
export function DebouncedInput({
  value: initialValue,
  onChange,
  debounce = 500,
  ...rest
}: InputProps & DebounceProps) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      onChange(value);
    }, debounce);

    return () => {
      clearTimeout(timeout);
    };
  }, [value]);

  return (
    <Input
      {...rest}
      value={value}
      size='sm'
      placeholder='Search'
      name='pod-search'
      type='text'
      autoComplete='off'
      onChange={e => {
        setValue(e.target.value);
      }}
      startDecorator={<SearchIcon />}
      // Clearing should not be debounced
      endDecorator={<IconButton onClick={() => {
        onChange('');
      }}><CloseIcon /></IconButton>}
      sx={{ flexGrow: 1, maxWidth: 500, minHeight: 36 }}
      slotProps={{
        input: {
          // Keep the input from auto capitalizing and autocorrecting, doesn't work
          // without both the input and the inputProps
          autoCorrect: 'off',
          autoComplete: 'off',
        },
      }}
    />
  );
}

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
  *
  * @param columns - The columns to display in the table.
  * @param data - The data to display in the table.
  * @returns The resource table.
  */
const ResourceTable = <T extends KubernetesResource>({ loader, columns, kind }: Props<T>) => {
  /**
  * Run our loader to get the data for the table
  * for now we'll pass the loader an empty object, but we could pass it
  */
  const { resources: data, error } = loader({});

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
    getRowId: row => row.metadata?.uid ? row.metadata.uid : Math.random().toString(36).substring(7),
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

  if (error) {
    return (
      <Box sx={{
        display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', width: '100%',
      }}>
        <Typography level='h2' color='danger'>
          Error loading {kind}: {error.message}
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
        sx={{
          display: { xs: 'none', sm: 'initial' },
          width: '100%',
          borderRadius: 'sm',
          flexShrink: 1,
          flexGrow: 1,
          overflow: 'scroll',
          minHeight: 0,
          maxHeight: '100%',
          // Hide the scrollbars
          '&::-webkit-scrollbar': {
            display: 'none',
          },
          scrollbarWidth: 'none',
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
          }}
        >
          <thead>
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
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
            {table.getRowModel().rows.map(row => (
              <MemoizedRow key={row.original.metadata?.uid} row={row} kind={kind} />
            ))}
          </tbody>
        </Table>
      </Sheet>
    </>
  );
};

export default ResourceTable;
