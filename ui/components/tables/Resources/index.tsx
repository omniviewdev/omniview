import { Spinner, Text } from '@omniviewdev/base-ui';
import { parseAppError, useResourceType } from '@omniviewdev/runtime';
import EnumerableResourceTable from './EnumerableResourceTable';
import ResourceLookup from './ResourceLookup';

type Props = { pluginID: string; connectionID: string; resourceKey: string };

// Mount only the advertised acquisition path. Get-only resources do not acquire
// enumerable targets, presentation definitions, or visible-row watches.
const ResourceTable = ({ pluginID, connectionID, resourceKey }: Props) => {
  const { resourceType } = useResourceType({ pluginID, route: { connection: connectionID }, type: resourceKey });
  if (resourceType.isLoading) {
    return <Spinner size="xl" />;
  }

  if (resourceType.isError) {
    return <Text tone="danger">{parseAppError(resourceType.error).detail}</Text>;
  }

  const descriptor = resourceType.data;
  if (!descriptor) {
    return null;
  }

  const props = { pluginID, connectionID, resourceKey, resourceType: descriptor };
  const key = JSON.stringify([pluginID, connectionID, resourceKey]);
  if (descriptor.capabilities.some(({ operation }) => operation === 'enumerate')) {
    return <EnumerableResourceTable key={key} {...props} />;
  }

  if (descriptor.capabilities.some(({ operation }) => operation === 'get')) {
    return <ResourceLookup key={key} {...props} />;
  }

  return <Text>{descriptor.displayName || resourceKey}: Catalog only. No enumerate or get operation is advertised.</Text>;
};

export default ResourceTable;
