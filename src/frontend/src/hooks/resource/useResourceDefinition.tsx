import { useQuery } from '@tanstack/react-query';

// third party
import { type ColumnDef } from '@tanstack/react-table';
import jsonpath from 'jsonpath';
import get from 'lodash.get';

// project imports
import { GetResourceDefinition } from '@api/resource/Client';
import { type types } from '@api/models';
import {
  SelectBoxHeader, 
  SelectBoxRow, 
} from '@/components/tables/ResourceTable/components';
import { type Actions } from '@/components/tables/Resources/actions/types';
import ActionMenu from '@/components/tables/Resources/actions/ActionMenu';
import { TextCell } from '@/components/tables/Resources/cells';
import ColumnFilter from '@/components/tables/Resources/ColumnFilter';
import { GetHandler } from '@api/exec/Client';


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
    default:
      return 'left';
  }
};

type ParseColumnDefOpts = {
  columnDefs?: types.ColumnDef[];
  actions?: Actions;
  pluginID: string;
  connectionID: string;
  resourceKey: string;
  namespaceAccessor?: string;
};

export type ResourceMetadata = {
  pluginID: string;
  connectionID: string;
  resourceID: string;
  resourceKey: string;
  namespace?: string;
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
  namespaceAccessor,
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
        if (def.accessor.startsWith('$.')) {
          return jsonpath.value(data, def.accessor) ?? '';
        }

        return get(data, def.accessor, '');
      },
      cell: ({ getValue, row }) => 
        <TextCell 
          align={getAlignment(def.align)} 
          value={getValue() as string} 
          formatter={def.formatter} 
          colorMap={def.colorMap}
          resourceLink={def.resourceLink}
          metadata={{
            pluginID,
            connectionID,
            resourceKey,
            resourceID: row.id,
            namespace: namespaceAccessor ? get(row.original, namespaceAccessor, '') : '',
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
      header: ({ table }) => <ColumnFilter columns={table.getAllFlatColumns()} />,
      cell: ({ row }) => <ActionMenu actions={actions} plugin={pluginID} connection={connectionID} resource={resourceKey} data={row.original} />,
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
  const queryKey = [pluginID, 'resource_definition',  resourceKey];

  const definition = useQuery({
    queryKey,
    queryFn: async () => GetResourceDefinition(pluginID, resourceKey),
    retry: false,
  });

  const actions = useQuery({
    queryKey: ['executions', pluginID, resourceKey, 'actions'],
    queryFn: async () => {
      const exec = await GetHandler(pluginID, resourceKey);
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
      namespaceAccessor: definition.data?.namespace_accessor,
    }),
  };
};

export default useResourceDefinition;
