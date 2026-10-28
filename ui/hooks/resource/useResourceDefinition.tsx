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
import ActionMenu from '@/components/tables/Resources/actions/ActionMenu';
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
  connectionID: string;
  resourceKey: string;
};

export type ResourceTableRow = { record: HostRecord; data: unknown };

export type ResourceMetadata = {
  pluginID: string;
  route: AccessRoute;
  record: HostRecord;
};


/**
 * Use our metadata and resource defenitions to dynamically build out our ColumnDefs at runtime.
 */
const parseColumnDef = ({
  columnDefs,
  actions,
  pluginID,
  connectionID,
  resourceKey,
}: ParseColumnDefOpts) => {
  if (columnDefs === undefined) {
    return {
      defs: [],
      visibility: {},
    };
  }

  const defs: Array<ColumnDef<any>> = [
    {
      id: 'select',
      header: SelectBoxHeader,
      cell: SelectBoxRow,
      size: 40,
      enableSorting: false,
      enableHiding: false,
    },
  ];

  columnDefs.forEach((def) => {
    let column: ColumnDef<any> = {
      id: def.id,
      header: def.header,
      accessorFn: (data) => {
        data = data.data;
        const val = def.accessor.split(',').map((accessor) => {
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
          Object.entries(def.valueMap).forEach(([key, val]) => {
            console.log('replacing', key, val);
            if (val === undefined) {
              return;
            }

            prioritized = prioritized.replace(new RegExp(key), val);
          });
        }

        if (prioritized !== '') {
          return prioritized;
        }

        return val.length === 1 ? val[0] : val;
      },
      cell: ({ getValue, row }) =>
        !!def.component
          // using a custom federated component
          ? <CustomTableCell
            plugin={pluginID}
            data={getValue()}
            component={def.component}
          />
          // in-house component
          : <TextCell
            align={getAlignment(def.align)}
            value={getValue() as string}
            formatter={def.formatter}
            colorMap={def.colorMap}
            resourceLink={def.resourceLink}
            metadata={{
              pluginID,
              route: row.original.record.route,
              record: row.original.record,
            }}
          />,
    };

    if (def.width) {
      column.size = def.width;
    }

    defs.push(column);
  });

  if (actions !== undefined) {
    // add the actions to the end
    defs.push({
      id: 'menu',
      cell: ({ row }) => <ActionMenu
        actions={actions}
        plugin={pluginID}
        connection={connectionID}
        resource={resourceKey}
        data={row.original.data}
        record={row.original.record}
      />,
      size: 50,
      enableSorting: false,
      enableHiding: false,
    });
  }

  return {
    defs,
    visibility: Object.fromEntries(columnDefs?.map((def) => [def.id, !def.hidden])),
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


  return {
    data: definition.data,
    isLoading: definition.isLoading,
    isError: definition.isError,
    error: definition.error,
    columns: parseColumnDef({
      columnDefs: definition.data?.columnDefs,
      actions: actions.data,
      pluginID,
      connectionID,
      resourceKey,
    }),
  };
};

export default useResourceDefinition;
