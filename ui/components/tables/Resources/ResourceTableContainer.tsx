import type { DataTableFeatures } from '@omniviewdev/base-ui';
import React, { useState } from 'react';

import { Stack, dataTableFeatures } from '@omniviewdev/base-ui';
import { LuChevronDown } from 'react-icons/lu';

// Tanstack/react-table
import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type ColumnVisibilityState as VisibilityState,
  flexRender,
  useTable,
  type RowSelectionState,
} from '@tanstack/react-table';

// Project imports
import styles from './ResourceTableContainer.module.css';
import { DebouncedInput } from './DebouncedInput';
import { RowContainer } from './RowContainer';
import { useVirtualizer } from '@tanstack/react-virtual';
import ColumnFilter from './ColumnFilter';
import { readProfileStorage, writeProfileStorage } from '@/features/instance/boot';
import type { ResourceTableRow } from '@/hooks/resource/useResourceDefinition';

export type Props = {
  /**
   * Column defenition for the table.
   */
  columns: Array<ColumnDef<DataTableFeatures, ResourceTableRow>>;

  /**
   * The data coming in
   */
  data: ResourceTableRow[];

  /**
   * The visibility state to start with for the columns.
   */
  initialColumnVisibility?: VisibilityState;


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


/**
  * Render a generic resource table with sorting, filtering, column visibility and row selection.
  * Use this component to display canonical provider records using tanstack/react-table.
  *
  * @param columns - The columns to display in the table.
  * @param data - The data to display in the table.
  * @returns The resource table.
  */
const ResourceTableContainer: React.FC<Props> = ({
  columns,
  data,
  pluginID,
  connectionID,
  resourceKey,
  initialColumnVisibility,
}) => {


  const [filterAnchor, setFilterAnchor] = React.useState<undefined | HTMLElement>(undefined);

  const handleFilterClick = (event: React.MouseEvent<HTMLElement>) => {
    setFilterAnchor(filterAnchor ? undefined : event.currentTarget);
  };

  const handleFilterClose = () => {
    setFilterAnchor(undefined);
  };

  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});


  // we have to use layout effect to set the column visibility before the table is repainted, use effect will cause a flicker
  // also can't just put it in the initial state because it will cause an issue with table render as well
  React.useLayoutEffect(() => {
    // check local storage to see if they've saved this
    const storedColumnVisibility = readProfileStorage(`${pluginID}-${connectionID}-${resourceKey}-column-visibility`);
    if (storedColumnVisibility && initialColumnVisibility) {
      const current = JSON.parse(storedColumnVisibility);

      // make sure any new filters are added if they weren't there before
      Object.entries(initialColumnVisibility).forEach(([key, value]) => {
        if (!current.hasOwnProperty(key)) {
          current[key] = value;
        }
      });

      setColumnVisibility(current);
    } else if (initialColumnVisibility) {
      setColumnVisibility(initialColumnVisibility);
    }
  }, [initialColumnVisibility, pluginID, connectionID, resourceKey]);

  React.useEffect(() => {
    let visibility = JSON.stringify(columnVisibility);
    // save changes to local storage
    if (visibility !== '{}') {
      writeProfileStorage(`${pluginID}-${connectionID}-${resourceKey}-column-visibility`, visibility);
    }
  }, [columnVisibility, pluginID, connectionID, resourceKey]);

  const [search, setSearch] = useState<string>('');

  const table = useTable<DataTableFeatures, ResourceTableRow>({
    features: dataTableFeatures,
    enableRowRangeSelection: false,
    manualPagination: true,
    manualExpanding: true,
    data,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setSearch,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    getRowId: (row) => row.record.key,
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
    estimateSize: () => 36,
    overscan: 40,
    // Measure dynamic row height, except in firefox because it measures table border height incorrectly
    measureElement:
      typeof window !== 'undefined'
        && !navigator.userAgent.includes('Firefox')
        ? element => element?.getBoundingClientRect().height
        : undefined,
  });


  return (
    <div className={styles.Root}>
      <Stack direction='row' justify='between' className={`NamespaceAndSearch ${styles.Toolbar}`}>
        <DebouncedInput
          value={search ?? ''}
          onChange={value => {
            setSearch(String(value));
          }}
          placeholder={`Search ${data.length} resources...`}
        />
        <Stack direction='row' spacing={2}>
          <ColumnFilter
            anchorEl={filterAnchor}
            onClose={handleFilterClose}
            columns={table.getAllFlatColumns()}
            onClick={handleFilterClick}
          />
        </Stack>
      </Stack>
      <div
        className={`table-container ${styles.TableContainer}`}
        ref={parentRef}
      >
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
                      // paddingTop: '12px', 
                      // paddingBottom: '12px', 
                      width: header.getSize() === Number.MAX_SAFE_INTEGER ? 'auto' : header.getSize(),
                      minWidth: header.getSize() === Number.MAX_SAFE_INTEGER ? 'auto' : header.getSize(),
                      maxWidth: header.getSize() === Number.MAX_SAFE_INTEGER ? 'auto' : header.getSize(),
                      flex: 1,
                    }}
                  >
                    {header.column.getCanSort()
                      ? <button
                        type='button'
                        className={styles.SortButton}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getIsSorted() && (
                          <LuChevronDown
                            className={styles.SortIcon}
                            data-desc={header.column.getIsSorted() as string === 'desc' ? 'true' : undefined}
                          />
                        )}
                      </button>
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
              height: `${virtualizer.getTotalSize()}px`, // Tells scrollbar how big the table is
              position: 'relative', // Needed for absolute positioning of rows
            }}
          >
            {virtualizer.getVirtualItems().map(virtualRow => {
              const row = rows[virtualRow.index];
              return (
                <RowContainer
                  key={row.id}
                  pluginID={pluginID}
                  row={row}
                  virtualizer={virtualizer}
                  virtualRow={virtualRow}
                  isSelected={rowSelection[row.id]}
                  columnVisibility={JSON.stringify(columnVisibility)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};


ResourceTableContainer.displayName = 'ResourceTableContainer';
ResourceTableContainer.whyDidYouRender = true;
export default ResourceTableContainer;
