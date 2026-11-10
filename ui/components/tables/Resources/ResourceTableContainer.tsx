import type { DataTableFeatureFlags, DataTableFeatures, DataTableRow } from '@omniviewdev/base-ui';
import React, { useState } from 'react';

import { DataTable, Stack, useDataTable } from '@omniviewdev/base-ui';

// Tanstack/react-table
import type {
  ColumnDef,
  ColumnPinningState,
  SortingState,
  ColumnVisibilityState as VisibilityState,
} from '@tanstack/react-table';

import { showAppError, useNotifications } from '@omniviewdev/runtime';

// Project imports
import styles from './ResourceTableContainer.module.css';
import { DebouncedInput } from './DebouncedInput';
import ColumnFilter from './ColumnFilter';
import { ActionMenuScope } from './actions/ActionMenu';
import type { Actions } from './actions/types';
import { useColumnVisibilityPreference } from './useColumnVisibilityPreference';
import useRightDrawer from '@/hooks/useRightDrawer';
import type { ResourceColumnMeta, ResourceTableRow } from '@/hooks/resource/useResourceDefinition';

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
   * The row actions the columns' action cells open. Leave unset for a table without them.
   */
  actions?: Actions;

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

  /**
   * Accessible name of the table. Defaults to the resource key.
   */
  label?: string;
};

/**
 * Sorting, global search and selection run in the shared table. Rows open the resource on click,
 * so the header offers sorting and nothing else.
 */
const TABLE_FEATURES: DataTableFeatureFlags = {
  sorting: true,
  filtering: true,
  globalFilter: true,
  rowSelection: 'multi',
};

const DEFAULT_SORTING: SortingState = [{ id: 'name', desc: false }];
/** Resource projections retain immutable host records across sparse patches. */
const TABLE_META = { dataTableImmutableRows: true } as const;

/** Selection and actions stay in view while the other columns scroll. */
const COLUMN_PINNING: ColumnPinningState = { start: ['select'], end: ['menu'] };

/** Height of a body row in px: the table's default row height token (`--ov-size-table-row-height-md`). */
const ROW_HEIGHT = 30;

/** Rows are identified by the host's record key, which stays the same as the provider patches the record. */
const getRowId = (row: ResourceTableRow) => row.record.key;

/**
  * Render a generic resource table with sorting, filtering, column visibility and row selection.
  * Use this component to display canonical provider records in the shared base-ui DataTable.
  *
  * Only the rows in view are mounted. Rows have a fixed height unless a visible column declares
  * `meta.rowHeight: 'content'`, which measures them. Clicking a row opens its resource unless the
  * clicked column declares `meta.opensDetail: false`.
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
  actions,
  label,
}) => {
  const { showResourceSidebar } = useRightDrawer();
  const { notify } = useNotifications();

  const [filterAnchor, setFilterAnchor] = React.useState<undefined | HTMLElement>(undefined);

  const handleFilterClick = (event: React.MouseEvent<HTMLElement>) => {
    setFilterAnchor(filterAnchor ? undefined : event.currentTarget);
  };

  const handleFilterClose = () => {
    setFilterAnchor(undefined);
  };

  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORTING);
  const [search, setSearch] = useState<string>('');
  const [columnVisibility, setColumnVisibility] = useColumnVisibilityPreference(
    `${pluginID}-${connectionID}-${resourceKey}-column-visibility`,
    initialColumnVisibility,
  );

  const table = useDataTable<ResourceTableRow>({
    data,
    columns,
    meta: TABLE_META,
    features: TABLE_FEATURES,
    enableMultiSort: true,
    getRowId,
    onSortingChange: setSorting,
    onGlobalFilterChange: setSearch,
    onColumnVisibilityChange: setColumnVisibility,
    state: {
      sorting,
      columnVisibility,
      globalFilter: search,
      columnPinning: COLUMN_PINNING,
    },
  });

  // Rows are measured only while a visible column renders content the table cannot size.
  const hasContentColumn = table.getVisibleLeafColumns().some((column) => {
    const meta: ResourceColumnMeta | undefined = column.columnDef.meta;
    return meta?.rowHeight === 'content';
  });

  /** Open the clicked row's resource, unless the click landed in a column that acts on its own. */
  const openDetail = (row: DataTableRow<ResourceTableRow>, event: React.MouseEvent<HTMLTableRowElement>) => {
    // A row's cells follow its visible columns, so the clicked cell's position names its column.
    const cell = event.target instanceof Element ? event.target.closest('td') : null;
    const index = cell ? Array.prototype.indexOf.call(event.currentTarget.children, cell) : -1;
    const meta: ResourceColumnMeta | undefined = row.getVisibleCells()[index]?.column.columnDef.meta;
    if (meta?.opensDetail === false) {
      return;
    }

    const { record } = row.original;
    void showResourceSidebar({
      pluginID,
      targetId: record.targetId,
      route: record.route,
      reference: record.record.reference,
      representation: record.record.representation.id,
      record,
    }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }

      showAppError(notify, error, `Failed to load resource: ${record.record.reference.address.id}`);
    });
  };

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
            table={table}
            onClick={handleFilterClick}
          />
        </Stack>
      </Stack>
      <ActionMenuScope actions={actions} plugin={pluginID} connection={connectionID} resource={resourceKey}>
        <DataTable.Root table={table} features={TABLE_FEATURES} hoverable className={styles.Table}>
          <DataTable.Container className={`table-container ${styles.Container}`} aria-label={label ?? resourceKey}>
            <DataTable.Header />
            <DataTable.VirtualBody<ResourceTableRow>
              className={styles.Body}
              estimateRowSize={ROW_HEIGHT}
              fixedRowHeight={!hasContentColumn}
              onRowClick={openDetail}
            />
          </DataTable.Container>
        </DataTable.Root>
      </ActionMenuScope>
    </div>
  );
};


ResourceTableContainer.displayName = 'ResourceTableContainer';
ResourceTableContainer.whyDidYouRender = true;
export default ResourceTableContainer;
