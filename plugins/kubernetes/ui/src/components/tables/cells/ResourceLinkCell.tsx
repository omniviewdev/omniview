import React from 'react';

// material ui
import { Chip } from '@omniviewdev/ui';
import type { SemanticColor } from '@omniviewdev/ui/types';
import { Text } from '@omniviewdev/ui/typography';
import { Tooltip } from '@omniviewdev/ui/overlays';

// third party
import get from 'lodash.get';

// icons
import {
  LuCopy,
  LuLayers,
  LuDatabase,
  LuPlay,
  LuClock,
  LuServer,
  LuUser,
  LuNetwork,
  LuGlobe,
  LuShield,
  LuBox,
} from 'react-icons/lu';

// types
import { type types } from '@omniviewdev/runtime/models';
import { useRightDrawer } from '@omniviewdev/runtime';
import { type ResourceMetadata } from '../../../hooks/useResourceDefinition';

type KindConfig = { color: SemanticColor; icon: React.ReactElement };

const kindConfigMap: Record<string, KindConfig> = {
  ReplicaSet:            { color: 'primary',   icon: <LuCopy size={10} /> },
  ReplicationController: { color: 'primary',   icon: <LuCopy size={10} /> },
  Deployment:            { color: 'primary',   icon: <LuCopy size={10} /> },
  StatefulSet:           { color: 'info',      icon: <LuDatabase size={10} /> },
  DaemonSet:             { color: 'warning',   icon: <LuLayers size={10} /> },
  Job:                   { color: 'secondary', icon: <LuPlay size={10} /> },
  CronJob:               { color: 'secondary', icon: <LuClock size={10} /> },
  Node:                  { color: 'success',   icon: <LuServer size={10} /> },
  ServiceAccount:        { color: 'neutral',   icon: <LuUser size={10} /> },
  Service:               { color: 'info',      icon: <LuNetwork size={10} /> },
  Ingress:               { color: 'info',      icon: <LuGlobe size={10} /> },
  NetworkPolicy:         { color: 'warning',   icon: <LuShield size={10} /> },
  PersistentVolume:      { color: 'neutral',   icon: <LuDatabase size={10} /> },
  PersistentVolumeClaim: { color: 'neutral',   icon: <LuDatabase size={10} /> },
};

const defaultConfig: KindConfig = { color: 'neutral', icon: <LuBox size={10} /> };

/** Extract the kind (last segment) from a resourceKey like "apps::v1::ReplicaSet" */
function kindFromKey(key: string): string {
  const parts = key.split('::');
  return parts[parts.length - 1];
}

type Props = types.ResourceLink & {
  value: any;
  metadata?: ResourceMetadata;
};

/**
 * Display the cell as a link to another resource with kind-appropriate icon and color.
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

  if (typeof value !== 'string' && !resourceKey) {
    return null;
  }

  const resolvedKey = keyMap ? keyMap[resourceKey] ?? resourceKey : resourceKey;
  const kind = kindFromKey(resolvedKey);
  const config = kindConfigMap[kind] ?? defaultConfig;

  const handleClick = () => {
    if (!metadata) return;
    showResourceSidebar({
      pluginID: metadata.pluginID,
      connectionID: metadata.connectionID,
      resourceKey: resolvedKey,
      resourceID,
      namespace,
    });
  };

  const label = displayId
    ? resourceID
    : typeof value === 'string' ? value : resourceKey;

  if (!displayId) {
    return (
      <Tooltip content={resourceID}>
        <Chip
          size='xs'
          emphasis='outline'
          color={config.color}
          icon={config.icon}
          onClick={handleClick}
          label={<Text size='xs' noWrap>{label}</Text>}
          sx={{ borderRadius: 1, maxWidth: '100%' }}
        />
      </Tooltip>
    );
  }

  return (
    <Chip
      size='xs'
      emphasis='outline'
      color={config.color}
      icon={config.icon}
      onClick={handleClick}
      label={<Text size='xs' noWrap>{label}</Text>}
      sx={{ borderRadius: 1, maxWidth: '100%' }}
    />
  );
};

export default ResourceLinkCell;
