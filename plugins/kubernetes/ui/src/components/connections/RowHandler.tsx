import React from 'react';
import { Box } from '@mui/joy';
import { useDraggable } from '@dnd-kit/core';
import type { EnrichedConnection } from '../../types/clusters';
import { useClusterAction } from '../../hooks/useClusterAction';
import HubClusterRow from './HubClusterRow';

type Props = {
  enriched: EnrichedConnection;
  /** Section identifier to make drag IDs unique across sections */
  sectionId?: string;
  subtitle?: string;
  showFavorite?: boolean;
  onRecordAccess: () => void;
  onToggleFavorite: () => void;
};

/**
 * Wrapper component that provides useClusterAction hook context
 * for each row, since useConnection requires connectionID at hook level.
 * Also makes the row draggable for folder assignment.
 */
const RowHandler: React.FC<Props> = ({
  enriched,
  sectionId = 'default',
  subtitle,
  showFavorite,
  onRecordAccess,
  onToggleFavorite,
}) => {
  const { handleClick } = useClusterAction(
    enriched.connection.id,
    enriched.isConnected,
    onRecordAccess,
  );

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `connection:${sectionId}:${enriched.connection.id}`,
    data: { type: 'connection', connectionId: enriched.connection.id, sectionId },
  });

  return (
    <Box
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      sx={{
        opacity: isDragging ? 0.4 : 1,
        cursor: isDragging ? 'grabbing' : 'grab',
        touchAction: 'none',
      }}
    >
      <HubClusterRow
        enriched={enriched}
        subtitle={subtitle}
        showFavorite={showFavorite}
        onToggleFavorite={onToggleFavorite}
        onClick={handleClick}
      />
    </Box>
  );
};

export default RowHandler;
