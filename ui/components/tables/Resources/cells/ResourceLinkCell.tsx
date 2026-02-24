import React from 'react';

// material ui
import { Chip } from '@omniviewdev/ui';
import { Text } from '@omniviewdev/ui/typography';
import { Tooltip } from '@omniviewdev/ui/overlays';

// third party
import get from 'lodash.get';

// types
import { type types } from '@omniviewdev/runtime/models';
import useRightDrawer from '@/hooks/useRightDrawer';
import { type ResourceMetadata } from '@/hooks/resource/useResourceDefinition';

type Props = types.ResourceLink & {
  value: any;
  metadata?: ResourceMetadata;
};

/**
 * Display the cell as a link to another resource
 */
const ResourceLinkCell: React.FC<Props> = ({
  value,
  metadata,
  idAccessor,
  namespaceAccessor,
  resourceKey,
  keyAccessor,
  keyMap,
  namespaced,
  displayId,
}) => {
  const { showResourceSidebar } = useRightDrawer();

  if (resourceKey === '') {
    resourceKey = get(value, keyAccessor, '');
  }

  let namespace = '';
  if (namespaced) {
    namespace = get(value, namespaceAccessor, metadata?.namespace ?? '');
  }

  const resourceID = typeof value === 'string' ? value : get(value, idAccessor, '');

  /**
   * Open the sidebar at the link to the linked resource
   */
  const handleClick: React.MouseEventHandler = (e) => {
    if (!metadata) {
      return;
    }

    e.stopPropagation();
    e.preventDefault();

    console.log('opening resource sidebar', {
      pluginID: metadata.pluginID,
      connectionID: metadata.connectionID,
      resourceKey: keyMap ? keyMap[resourceKey] ?? resourceKey : resourceKey,
      resourceID,
      namespace,
    });

    showResourceSidebar({
      pluginID: metadata.pluginID,
      connectionID: metadata.connectionID,
      resourceKey: keyMap ? keyMap[resourceKey] ?? resourceKey : resourceKey,
      resourceID,
      namespace,
    });
  };

  if (typeof value !== 'string' && !resourceKey) {
    return null;
  }

  if (displayId) {
    return (
      <Chip
        size='sm'
        emphasis='soft'
        color={typeof value === 'string' ? 'neutral' : 'primary'}
        sx={{
          borderRadius: 'sm',
        }}
        onClick={handleClick}
        label={resourceID}
      />
    );
  }

  return (
    <Tooltip size='sm' emphasis='ghost' content={resourceID}>
      <Chip
        size='sm'
        emphasis='soft'
        color={typeof value === 'string' ? 'neutral' : 'primary'}
        sx={{
          borderRadius: 'sm',
        }}
        onClick={handleClick}
        label={typeof value === 'string' ? value : resourceKey}
      />
    </Tooltip>
  );
};

export default ResourceLinkCell;
