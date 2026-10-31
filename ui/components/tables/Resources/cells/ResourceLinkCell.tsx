import React from 'react';

import { Chip } from '@omniviewdev/base-ui';

// third party
import get from 'lodash.get';

// types
import type { ResourceLink } from '@omniviewdev/runtime';
import { ResourceClient } from '@omniviewdev/runtime/api';
import useRightDrawer from '@/hooks/useRightDrawer';
import { showAppError, useSnackbar, valueToJSON } from '@omniviewdev/runtime';
import { type ResourceMetadata } from '@/hooks/resource/useResourceDefinition';
import HintTooltip from '@/components/base/HintTooltip';
import styles from './cells.module.css';

type Props = ResourceLink & {
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
  type,
  typeAccessor,
  typeMap,
  scopeAccessors,
  displayId,
}) => {
  const { showResourceSidebar } = useRightDrawer();
  const { showSnackbar } = useSnackbar();

  const extractedType = type !== undefined && type !== null && type !== '' ? type : get(value, typeAccessor ?? '', '');
  const resourceKey = typeMap?.[extractedType] ?? extractedType;

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

    void (async () => {
      const source = valueToJSON(metadata.record.record.body);
      const scope = (scopeAccessors ?? []).map(({ dimension, fieldPath }) => {
        const entry = get(source, fieldPath);
        if (typeof entry !== 'string') {
          throw new Error(`Linked resource scope ${dimension} is unavailable.`);
        }

        return { dimension, value: entry };
      });
      const resolved = await ResourceClient.ResolveReference(metadata.pluginID, {
        route: metadata.route,
        type: resourceKey,
        id: resourceID,
        scope,
      });
      await showResourceSidebar({
        pluginID: metadata.pluginID,
        route: resolved.route,
        reference: resolved.reference,
        representation: resolved.representation,
        targetId: resolved.targetId,
      });
    })().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }

      showAppError(showSnackbar, error, `Failed to load resource: ${resourceID}`);
    });
  };

  if (typeof value !== 'string' && !resourceKey) {
    return null;
  }

  if (displayId) {
    return (
      <Chip
        size='sm'
        variant='soft'
        color={typeof value === 'string' ? 'neutral' : 'brand'}
        clickable
        className={styles.LinkChip}
        onClick={handleClick}
      >
        {resourceID}
      </Chip>
    );
  }

  return (
    <HintTooltip content={resourceID}>
      <Chip
        size='sm'
        variant='soft'
        color={typeof value === 'string' ? 'neutral' : 'brand'}
        clickable
        className={styles.LinkChip}
        onClick={handleClick}
      >
        {typeof value === 'string' ? value : resourceKey}
      </Chip>
    </HintTooltip>
  );
};

export default ResourceLinkCell;
