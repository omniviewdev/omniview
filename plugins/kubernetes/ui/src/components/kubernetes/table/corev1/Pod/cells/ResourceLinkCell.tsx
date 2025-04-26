import React from 'react';

// material ui
import {
  Chip,
} from '@mui/joy';

type Props = {
  /** ID of the connection this is connecting to */
  connectionId: string;

  /** Namespace of the resource being referenced (if there is one) */
  namespace?: string;

  /** ID of the resource being referenced */
  resourceId: string;

  /** The key identifying the resource (e.g. core::v1::Node) */
  resourceKey: string;

  /** The readable name of the resource (e.g. Node) */
  resourceName: string;
}

/**
 * Display the cell as a link to another resource
 */
const ResourceLinkCell: React.FC<Props> = ({
  connectionId, namespace, resourceId, resourceKey, resourceName
}) => {
  // const { showResourceSidebar } = useRightDrawer();

  /**
   * Open the sidebar at the link to the linked resource
   */
  const handleClick: React.MouseEventHandler = (e) => {
    e.stopPropagation();
    e.preventDefault();

    console.log('opening resource sidebar', {
      connectionId,
      resourceKey,
      resourceId,
      namespace,
    });

    // showResourceSidebar({
    //   pluginID: metadata.pluginID,
    //   connectionID: metadata.connectionID,
    //   resourceKey: keyMap ? keyMap[resourceKey] ?? resourceKey : resourceKey,
    //   resourceID,
    //   namespace,
    // });
  };

  return (
    <Chip
      size='sm'
      variant='soft'
      color={'primary'}
      sx={{
        borderRadius: 'sm',
      }}
      onClick={handleClick}>
      {resourceName}
    </Chip>
  );
};

export default ResourceLinkCell;
