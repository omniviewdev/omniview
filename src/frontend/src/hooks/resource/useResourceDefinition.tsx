import { useQuery } from '@tanstack/react-query';

// Underlying client
import { GetResourceDefinition } from '@api/resource/Client';
import { type types } from '@api/models';
import { type ColumnDef } from '@tanstack/react-table';
import {
  SelectBoxHeader, 
  SelectBoxRow, 
  RowMenu,
} from '@/components/tables/ResourceTable/components';
import { TextCell } from '@/components/tables/Resources/cells';

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

const parseColumnDef = (columnDefs?: types.ColumnDef[]) => {
  if (columnDefs === undefined) {
    return [];
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
    const column: ColumnDef<any> = {
      id: def.id,
      header: def.header,
      accessorKey: def.accessor,
      cell: ({ getValue }) => <TextCell value={getValue() as string} formatter={def.formatter} />,
    };

    if (def.width) {
      column.size = def.width;
    }

    defs.push(column);
  });

  // add the actions to the end
  defs.push({
    id: 'menu',
    header: '',
    cell: RowMenu,
    size: 50,
    enableSorting: false,
    enableHiding: false,
  });

  return defs;
};

/**
 * Fetches the resource definition for the given resource key and returns calculated resource
 * schema objects for rendering the resource.
 */
export const useResourceDefinition = ({ pluginID, resourceKey }: UseResourceDefinitionOptions) => {
  const queryKey = [pluginID, 'resource_definition',  resourceKey];

  const definition = useQuery({
    queryKey,
    queryFn: async () => GetResourceDefinition(pluginID, resourceKey),
    retry: false,
  });

  return {
    data: definition.data,
    isLoading: definition.isLoading,
    isError: definition.isError,
    error: definition.error,
    columnDefs: parseColumnDef(definition.data?.columnDefs),
  };
};

export default useResourceDefinition;
