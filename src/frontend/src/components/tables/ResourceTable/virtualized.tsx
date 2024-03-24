import {
  useState, useRef, useCallback, memo, type FC,
} from 'react';

// Material-ui
import Box from '@mui/joy/Box';
import Typography from '@mui/joy/Typography';
import Link from '@mui/joy/Link';
import Sheet from '@mui/joy/Sheet';
import Table from '@mui/joy/Table';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';

// Tanstack/react-table
import {
  type ColumnFiltersState,
  type Row,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  // GetPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { type VirtualItem, useVirtualizer } from '@tanstack/react-virtual';
import {
  DebouncedInput, type KubernetesResource, type Props, namespaceFilter,
} from '.';
import NamespaceSelect from '@/components/selects/NamespaceSelect';
import { Stack, styled } from '@mui/joy';
import useRightDrawer from '@/hooks/useRightDrawer';
import { usePluginRouter } from '@infraview/router';

type RowComponentProps = {
  virtualizer: ReturnType<typeof useVirtualizer>;
  virtualRow: VirtualItem;
  row: Row<KubernetesResource>;
  kind: string;
  isSelected: boolean;
  clusterID: string;
};

const ResizerBlock = styled('div')(({ theme }) => ({
  position: 'absolute',
  top: 5,
  bottom: 5,
  width: '1px',
  background: theme.palette.divider,
  paddingTop: 1,
  paddingBottom: 2,
  cursor: 'col-resize',
  userSelect: 'none',
  touchAction: 'none',
  '&.ltr': {
    right: 0,
  },
  '&.rtl': {
    left: 0,
  },
  '&.isResizing': {
    background: theme.palette.common.white,
    opacity: 1,
    width: '5px',
    top: 0,
    bottom: 0,
  },
  '@media (hover: hover)': {
    opacity: 0,
    '&:hover': {
      top: 0,
      bottom: 0,
      width: '5px',
      opacity: 1,
    },
  },
}));

type ResizerProps = {
  header: any;
  table: any;
};

/**
 * Resizer component for resizing columns
 */
const Resizer: FC<ResizerProps> = ({ header, table }) => (
  <ResizerBlock
    {...{
      onDoubleClick: () => header.column.resetSize(),
      onMouseDown: header.getResizeHandler(),
      onTouchStart: header.getResizeHandler(),
      className: `resizer ${table.options.columnResizeDirection
      } ${header.column.getIsResizing() ? 'isResizing' : ''
      }`,
      style: {
        transform:
            header.column.getIsResizing()
            	? `translateX(${(table.options.columnResizeDirection
                === 'rtl'
            		? -1
            		: 1)
              * (table.getState().columnSizingInfo
              	.deltaOffset ?? 0)
            	}px)`
            	: '',
      },
    }}
  />
);

// Import useRightDrawer or any relevant hooks/context if necessary
const RowComponent = memo(({ virtualizer, virtualRow, row, kind, isSelected }: RowComponentProps) => {
  // Assuming useRightDrawer is a hook that provides showResourceSpec function
  const { showResourceSpec } = useRightDrawer();

  // Use the provided ref callback to measure items
  const ref = useCallback((node: HTMLTableRowElement) => {
    virtualizer.measureElement(node);
  }, [virtualizer, virtualRow.index]);

  return (
    <tr
      data-index={virtualRow.index}
      ref={ref} // Measure dynamic row height
      key={row.id}
      data-state={isSelected ? 'selected' : undefined}
      style={{
        display: 'flex',
        position: 'absolute',
        transform: `translateY(${virtualRow.start}px)`, // This should always be a `style` as it changes on scroll
        width: '100%',
      }}
    >
      {row.getVisibleCells().map(cell => {
        const width = cell.column.getSize() === Number.MAX_SAFE_INTEGER ? 'auto' : cell.column.getSize();
        return (
          <td
            key={cell.id}
            onClick={cell.column.id === 'name' ? () => {
              showResourceSpec(kind.toLowerCase(), cell.getValue() as string, row.original);
            } : undefined}
            style={{
              display: 'flex',
              alignItems: 'center',
              maxWidth: width,
              minWidth: width,
              flexGrow: 1,
              textOverflow: 'ellipsis',
              overflow: 'hidden',
            }}
          >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </td>
        );
      })}
    </tr>
  );
}, (prevProps, nextProps) =>
// Example memoization condition, adjust according to your actual needs
  prevProps.clusterID === nextProps.clusterID
    && prevProps.row.original.metadata?.uid === nextProps.row.original.metadata?.uid
    && prevProps.row.original.metadata?.resourceVersion === nextProps.row.original.metadata?.resourceVersion
    && prevProps.virtualRow.start === nextProps.virtualRow.start && prevProps.isSelected === nextProps.isSelected,
);

RowComponent.displayName = 'RowComponent';

/**
  * Render a generic resource table with sorting, filtering, column visibility and row selection.
  * Use this component to display a generic table for any Kubernetes resource using tanstack/react-table.
  * This is a work in progress as the virtualization is not working perfectly as expected
  *
  * @param columns - The columns to display in the table.
  * @param data - The data to display in the table.
  * @returns The resource table.
  */
const ResourceTableVirtualized = <T extends KubernetesResource>({ loader, columns, kind, clusters }: Props<T>) => {
  // TODO - MOVE THIS TO THE PARENT COMPONENT!!! - This is a temporary solution to get the clusterId
  // in for all the resources
  const { contextID } = usePluginRouter();

  /**
  * Run our loader to get the data for the table
  * for now we'll pass the loader an empty object, but we could pass it
  */
  const { resources: data, error } = loader({ clusters: clusters?.length ? clusters : [contextID] });

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
    // GetItemKey: useCallback((index: number) => rows[index]?.id ?? index, [rows]),
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
              /* @ts-expect-error - stop warning about an lsp error that's not true... */
                <RowComponent key={row.id} virtualizer={virtualizer} virtualRow={virtualRow} row={row} kind={kind} isSelected={Boolean(rowSelection[row.id])} clusterID={contextID} />
              );
            })}
          </tbody>
        </Table>
      </Sheet>
    </>
  );
};

export default ResourceTableVirtualized;
