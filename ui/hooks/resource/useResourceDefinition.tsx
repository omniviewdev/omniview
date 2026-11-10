import { useMemo } from 'react';
import { Text, type DataTableFeatures } from '@omniviewdev/base-ui';
import { useQuery } from '@tanstack/react-query';

// third party
import { type ColumnDef } from '@tanstack/react-table';
import jsonpath from 'jsonpath';
import get from 'lodash.get';

// project imports
import { ResourceClient, ExecClient } from '@omniviewdev/runtime/api';
import type { AccessRoute, ColumnDefinition, HostRecord } from '@omniviewdev/runtime';
import SelectBoxHeader from '@/components/tables/Resources/cells/SelectBoxHeader';
import SelectBoxRow from '@/components/tables/Resources/cells/SelectBoxRow';
import { type Actions } from '@/components/tables/Resources/actions/types';
import { ActionMenuTrigger, isActionableBody } from '@/components/tables/Resources/actions/ActionMenu';
import { TextCell } from '@/components/tables/Resources/cells';
import CustomTableCell from '@/components/tables/Resources/cells/CustomTableCell';


type UseResourceDefinitionOptions = {
  /**
   * The ID of the category responsible for this resource
   * @example "appearance"
   */
  pluginID: string;
  /**
   * The ID of the connection
   */
  connectionID: string;
  /**
  * Resource key that uniquely identifies the resource
  */
  resourceKey: string;
};

const getAlignment = (align?: string) => {
  switch (align) {
    case 'CENTER':
      return 'center';
    case 'RIGHT':
      return 'right';
    case undefined:
    default:
      return 'left';
  }
};

type ParseColumnDefOpts = {
  columnDefs?: readonly ColumnDefinition[];
  actions?: Actions;
  pluginID: string;
  resourceKey: string;
};

export type ResourceTableRow = { record: HostRecord; data: unknown };

export type ResourceMetadata = {
  pluginID: string;
  route: AccessRoute;
  record: HostRecord;
};

/**
 * What a column tells the generic table through `ColumnDef.meta`. The table reads these hints and
 * never branches on a column's ID, its resource type or its plugin.
 */
export type ResourceColumnMeta = {
  /** Horizontal alignment shared by the column's header and cells. */
  align?: 'left' | 'center' | 'right';
  /**
   * The cells render from the row's data alone, so selection, sorting and filtering edits need not
   * render them again. Cells that read table state themselves must leave this unset.
   */
  dataTableCellDependencies?: 'data';
  /** `false` when clicks in the column's cells act on their own control instead of opening the row. */
  opensDetail?: boolean;
  /**
   * `content` when the cells render output the table cannot size, such as a plugin's component. Rows
   * are measured while such a column is visible. Other columns keep the fixed row height.
   */
  rowHeight?: 'content';
};

/** The table columns built from a resource definition. */
export type ResourceColumns = {
  defs: Array<ColumnDef<DataTableFeatures, ResourceTableRow>>;
  /** Whether each declared column starts visible. */
  visibility: Record<string, boolean>;
  /** The row actions to mount. Present exactly when `defs` includes the actions column. */
  actions: Actions | undefined;
};

/**
 * Read a row's value for one column definition: its comma-separated accessors, the declared
 * priority between them, then its value map.
 */
const columnAccessor = (def: ColumnDefinition) => {
  const accessors = def.accessor.split(',');
  // Patterns compile on first use, like the replacements they drive. An invalid one never fails an empty table.
  let replacements: Array<readonly [RegExp, string]> | undefined;

  return (row: ResourceTableRow) => {
    const data = row.data;
    const val = accessors.map((accessor) => {
      if (accessor.startsWith('$.')) {
        return jsonpath.value(data, accessor) ?? '';
      }

      return get(data, accessor, '');
    }).filter((v) => v !== undefined && v !== '');

    let prioritized = '';
    switch (def.accessorPriority) {
      case 'FIRST':
        prioritized = val[0];
        break;
      case 'LAST':
        prioritized = val[val.length - 1];
        break;
      case undefined:
      default:
        break;
    }

    if (def.valueMap) {
      // process the prioritized value through the value map, each key being the regex to match
      // and the value being the replacement
      replacements ??= Object.entries(def.valueMap).flatMap(([key, replacement]) =>
        replacement === undefined ? [] : [[new RegExp(key), replacement] as const]);
      for (const [pattern, replacement] of replacements) {
        prioritized = prioritized.replace(pattern, replacement);
      }
    }

    if (prioritized !== '') {
      return prioritized;
    }

    return val.length === 1 ? val[0] : val;
  };
};


/**
 * Use our metadata and resource defenitions to dynamically build out our ColumnDefs at runtime.
 */
const parseColumnDef = ({
  columnDefs,
  actions,
  pluginID,
  resourceKey,
}: ParseColumnDefOpts): ResourceColumns => {
  if (columnDefs === undefined) {
    return {
      defs: [],
      visibility: {},
      actions: undefined,
    };
  }

  // Selection and actions are controls of their own: a click in either never opens the row.
  const selectMeta: ResourceColumnMeta = { opensDetail: false, dataTableCellDependencies: 'data' };
  const actionsMeta: ResourceColumnMeta = { align: 'center', opensDetail: false, dataTableCellDependencies: 'data' };
  const defs: Array<ColumnDef<DataTableFeatures, ResourceTableRow>> = [
    {
      id: 'select',
      header: SelectBoxHeader,
      cell: SelectBoxRow,
      size: 40,
      enableSorting: false,
      enableHiding: false,
      // Fixed width: the column keeps its size while the others share the remaining space.
      enableResizing: false,
      meta: selectMeta,
    },
  ];

  columnDefs.forEach((def) => {
    const component = def.component;
    const align = getAlignment(def.align);
    const meta: ResourceColumnMeta = {
      align,
      dataTableCellDependencies: 'data',
      rowHeight: component ? 'content' : undefined,
    };
    const column: ColumnDef<DataTableFeatures, ResourceTableRow> = {
      id: def.id,
      header: def.header,
      accessorFn: columnAccessor(def),
      cell: component
        // a component the provider declared, resolved from the extension registry
        ? ({ getValue }) => (
          <CustomTableCell
            plugin={pluginID}
            resourceKey={resourceKey}
            data={getValue()}
            component={component}
            componentParams={def.componentParams}
          />
        )
        // in-house component
        : ({ getValue, row }) => (
          <TextCell
            align={align}
            value={getValue()}
            formatter={def.formatter}
            colorMap={def.colorMap}
            resourceLink={def.resourceLink}
            metadata={{
              pluginID,
              route: row.original.record.route,
              record: row.original.record,
            }}
          />
        ),
      meta,
    };

    if (def.width) {
      // A declared width is exact, not a preference.
      column.size = def.width;
      column.minSize = def.width;
      column.maxSize = def.width;
      column.enableResizing = false;
    }

    defs.push(column);
  });

  if (actions !== undefined) {
    // add the actions to the end
    defs.push({
      id: 'menu',
      cell: ({ row }) => isActionableBody(row.original.data)
        ? <ActionMenuTrigger row={row.original} />
        : <Text size="xs" tone="muted">Resource actions require an object body.</Text>,
      size: 50,
      enableSorting: false,
      enableHiding: false,
      enableResizing: false,
      meta: actionsMeta,
    });
  }

  return {
    defs,
    visibility: Object.fromEntries(columnDefs.map((def) => [def.id, !def.hidden])),
    actions,
  };
};

/**
 * Fetches the resource definition for the given resource key and returns calculated resource
 * schema objects for rendering the resource.
 */
export const useResourceDefinition = ({ pluginID, resourceKey, connectionID }: UseResourceDefinitionOptions) => {
  const route = { connection: connectionID };
  const queryKey = [pluginID, 'resource_definition', route, resourceKey];

  const definition = useQuery({
    queryKey,
    queryFn: async () => ResourceClient.GetResourceDefinition(pluginID, route, resourceKey),
    retry: false,
  });

  const actions = useQuery({
    queryKey: ['executions', pluginID, resourceKey, 'actions'],
    queryFn: async () => {
      const exec = await ExecClient.GetHandler(pluginID, resourceKey);
      return {
        exec,
      };
    },
    retry: false,
  });

  // Mounted cells compare their column's renderer by identity. Rebuild the columns only when the
  // definition or the actions change, not each time the table's rows do.
  const columnDefs = definition.data?.columnDefs;
  const columns = useMemo(
    () => parseColumnDef({ columnDefs, actions: actions.data, pluginID, resourceKey }),
    [columnDefs, actions.data, pluginID, resourceKey],
  );

  return {
    data: definition.data,
    isLoading: definition.isLoading,
    isError: definition.isError,
    error: definition.error,
    columns,
  };
};

export default useResourceDefinition;
