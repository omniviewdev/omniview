import React from 'react';

// material ui
import {
  Chip,
} from '@mui/joy';

import { useRightDrawer } from '@omniviewdev/runtime';

type Props = {
  /** ID of the plugin this resource belongs to */
  pluginID: string;

  /** ID of the connection this is connecting to */
  connectionId: string;

  /** Namespace of the resource being referenced (if there is one) */
  namespace?: string;

  /** ID of the resource being referenced */
  resourceId: string;

  /** The key identifying the resource (e.g. core::v1::Node) */
  resourceKey: string;

  /** The readable name of the resource (e.g. Node) */
  resourceName?: string;
}

/**
 * Display the cell as a link to another resource
 */
const ResourceLinkCell: React.FC<Props> = ({
  pluginID,
  connectionId,
  namespace,
  resourceId,
  resourceKey,
  resourceName,
}) => {
  const { showResourceSidebar } = useRightDrawer();

  if (!resourceName) {
    // nothing to display - don't render
    return <></>
  }

  /**
   * Open the sidebar at the link to the linked resource
   */
  const handleClick: React.MouseEventHandler = (e) => {
    e.stopPropagation();
    e.preventDefault();

    showResourceSidebar({
      pluginID,
      connectionID: connectionId,
      resourceKey,
      resourceID: resourceId,
      namespace,
    });
  };

  return (
    <Chip
      size='sm'
      variant='soft'
      color={'primary'}
      sx={{
        borderRadius: 2,
      }}
      onClick={handleClick}>
      {resourceName}
    </Chip>
  );
};

export default ResourceLinkCell;
