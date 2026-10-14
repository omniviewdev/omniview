import React from 'react';
import { DataTable } from '@omniviewdev/base-ui';
import type { RowSelectionState, Table, VisibilityState } from '@tanstack/react-table';
import type { DrawerComponent } from '@omniviewdev/runtime';

import ResourceTableBody from './ResourceTableBody';
import { DebouncedInput } from '../DebouncedInput';
import type { Memoizer } from './types';
import styles from './ResourceTable.module.css';

type Props = {
  table: Table<any>;
  isLoading: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  connectionID: string;
  resourceKey: string;
  columnVisibility: VisibilityState;
  rowSelection: RowSelectionState;
  drawer?: DrawerComponent;
  memoizer?: Memoizer;
  onRowClick?: (id: string, data: any) => void;
};

const rootStyle = {
  '--_ov-dt-bg': 'var(--ov-color-bg-base)',
  '--_ov-dt-pinned-bg': 'var(--ov-color-bg-base)',
  '--_ov-dt-header-bg': 'var(--ov-color-bg-surface)',
} as React.CSSProperties;

/**
 * Shared frame for the plugin's resource tables: base-ui DataTable root, header and
 * container with a search toolbar and a locally virtualized body.
 */
const ResourceTableFrame: React.FC<Props> = ({
  table,
  isLoading,
  search,
  onSearchChange,
  searchPlaceholder,
  connectionID,
  resourceKey,
  columnVisibility,
  rowSelection,
  drawer,
  memoizer,
  onRowClick,
}) => {
  const parentRef = React.useRef<HTMLDivElement>(null) as React.RefObject<HTMLDivElement>;

  return (
    <div className={styles.outer}>
      <DataTable.Root
        table={table}
        size='sm'
        features={{ sorting: true }}
        className={styles.root}
        style={rootStyle}
      >
        {/* Compact toolbar — outside scroll container so it never scrolls horizontally */}
        <div className={styles.toolbar}>
          <DebouncedInput
            value={search ?? ''}
            onChange={onSearchChange}
            placeholder={searchPlaceholder}
          />
          <div style={{ flex: 1 }} />
        </div>
        <DataTable.Container
          ref={parentRef}
          className={styles.container}
          style={{ '--_aws-table-min-width': `${table.getTotalSize()}px` } as React.CSSProperties}
        >
          <DataTable.Header />
          {isLoading ? (
            <DataTable.Loading rows={8} />
          ) : (
            <ResourceTableBody
              table={table}
              tableContainerRef={parentRef}
              connectionID={connectionID}
              resourceKey={resourceKey}
              columnVisibility={JSON.stringify({ columnVisibility })}
              rowSelection={rowSelection}
              drawer={drawer}
              memoizer={memoizer}
              onRowClick={onRowClick}
            />
          )}
        </DataTable.Container>
      </DataTable.Root>
    </div>
  );
};

export default ResourceTableFrame;
