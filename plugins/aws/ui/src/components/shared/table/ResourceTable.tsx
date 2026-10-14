import React, { useState } from 'react';

import { Banner, Text } from '@omniviewdev/base-ui';

import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type RowSelectionState,
} from '@tanstack/react-table';
import get from 'lodash.get';

import ResourceTableFrame from './ResourceTableFrame'
import { useResources, DrawerComponent } from '@omniviewdev/runtime';
import { LuCircleAlert } from 'react-icons/lu';
import { plural } from '../../../utils/language';
import { withFlexSizing } from './utils';
import { ColumnMeta } from './types';
import { useStoredState } from '../hooks/useStoredState';

export type Memoizer = string | string[] | ((data: any) => string);

const visibilityFromColumnDefs = (defs: Array<ColumnDef<any>>): VisibilityState => {
  const visibility: VisibilityState = {}
  defs.forEach((def) => {
    let meta = def?.meta as { defaultHidden?: boolean } || undefined
    if (meta === undefined) {
      meta = {}
    }
    if (def.id && meta?.defaultHidden !== undefined) {
      visibility[def.id] = !meta.defaultHidden
    }
  })
  return visibility
}

export type Props<T = any> = {
  connectionID: string;
  resourceKey: string;
  columns: Array<ColumnDef<T> & ColumnMeta>;
  idAccessor: string;
  memoizer?: Memoizer;
  drawer?: DrawerComponent;
  onRowClick?: (id: string, data: any) => void;
};

const defaultData: any[] = []

const errorStyle: React.CSSProperties = {
  display: 'flex',
  gap: 32,
  justifyContent: 'center',
  flexDirection: 'column',
  alignItems: 'center',
  height: '100%',
  width: '100%',
  userSelect: 'none',
};

const ResourceTableContainer: React.FC<Props> = ({
  connectionID,
  resourceKey,
  columns,
  idAccessor,
  memoizer,
  drawer,
  onRowClick,
}) => {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }]);
  const [columnVisibility, setColumnVisibility] = useStoredState<VisibilityState>(`aws-${connectionID}-${resourceKey}-column-visibility`, visibilityFromColumnDefs(columns));
  const [columnFilters, setColumnFilters] = useStoredState<ColumnFiltersState>(`aws-${connectionID}-${resourceKey}-column-filters`, []);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [search, setSearch] = useState<string>('');

  const { resources } = useResources({ pluginID: 'aws', connectionID, resourceKey, idAccessor });

  const sizedColumns = React.useMemo(() => withFlexSizing(columns), [columns]);

  const table = useReactTable({
    data: resources.data?.result || defaultData,
    columns: sizedColumns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    getRowId: (row) => get(row, idAccessor),
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      globalFilter: search,
      columnPinning: { left: ['select'], right: ['menu'] }
    },
  });

  const placeHolderText = () => {
    const keyparts = resourceKey.split('::');
    const resource = plural(keyparts[keyparts.length - 1]);
    const count = resources.data?.result.length
    return `Search ${count ? `${count} ` : ''}${resource}...`;
  };

  if (resources.isError) {
    const errstring = resources.error?.toString();
    console.error('Failed loading resources', errstring);

    return (
      <div style={errorStyle}>
        <Banner color='danger' size='lg'>
          <Banner.Icon><LuCircleAlert size={20} /></Banner.Icon>
          <Banner.Content>
            <Text weight="semibold" size="lg" tone="danger">
              Failed loading {resourceKey} resources
            </Text>
          </Banner.Content>
        </Banner>
        <Text as="div" size="sm" tone="danger" style={{ textAlign: 'center', maxWidth: 500 }}>
          An error occurred while loading resources. Check your AWS credentials and region configuration.
        </Text>
      </div>
    );
  }

  return (
    <ResourceTableFrame
      table={table}
      isLoading={resources.isLoading}
      search={search}
      onSearchChange={value => setSearch(String(value))}
      searchPlaceholder={placeHolderText()}
      connectionID={connectionID}
      resourceKey={resourceKey}
      columnVisibility={columnVisibility}
      rowSelection={rowSelection}
      drawer={drawer}
      memoizer={memoizer}
      onRowClick={onRowClick}
    />
  );
};

ResourceTableContainer.displayName = 'ResourceTableContainer';

export default ResourceTableContainer;
