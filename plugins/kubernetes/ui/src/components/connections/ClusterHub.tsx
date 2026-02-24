import React from 'react';
import Box from '@mui/material/Box';
import { Card } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';

import type {
  EnrichedConnection,
  ConnectionAttribute,
  ConnectionGroup,
  HubSectionConfig,
  HubSectionType,
} from '../../types/clusters';
import { useHubSections, type HubSectionData } from '../../hooks/useHubSections';
import HubSection from './HubSection';
import GroupBrowser from './GroupBrowser';
import RowHandler from './RowHandler';
import QuickConnectGrid from './QuickConnectGrid';

type Props = {
  enrichedConnections: EnrichedConnection[];
  availableAttributes: ConnectionAttribute[];
  customGroups: ConnectionGroup[];
  hubSections: HubSectionConfig[];
  onReorderSections: (sections: HubSectionConfig[]) => void;
  onToggleCollapse: (sectionType: HubSectionType, collapsed: boolean) => void;
  onRecordAccess: (connectionId: string) => void;
  onToggleFavorite: (connectionId: string) => void;
  onAssignToGroup?: (groupId: string, connectionId: string) => void;
  onRemoveFromGroup?: (groupId: string, connectionId: string) => void;
  onCreateFolder?: (connectionId?: string) => void;
  onEditFolder?: (groupId: string) => void;
};

function formatRelativeTime(timestamp?: number): string {
  if (!timestamp) return '';
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

const ClusterHub: React.FC<Props> = ({
  enrichedConnections,
  availableAttributes,
  customGroups,
  hubSections: hubSectionConfigs,
  onReorderSections,
  onToggleCollapse,
  onRecordAccess,
  onToggleFavorite,
  onAssignToGroup,
  onRemoveFromGroup,
  onCreateFolder,
  onEditFolder,
}) => {
  const { sections, reorderSections } = useHubSections({
    enrichedConnections,
    hubSectionConfigs,
    customGroups,
    availableAttributes,
  });

  // Track active drag for overlay
  const [activeDrag, setActiveDrag] = React.useState<{
    type: 'connection' | 'section';
    id: string;
    connectionId?: string;
  } | null>(null);

  const visibleSections = React.useMemo(
    () => sections.filter(s => {
      if (s.config.type === 'browse') return availableAttributes.length > 0;
      // Always show group sections (folders) even if empty
      if (s.config.type.startsWith('group:')) return true;
      return s.data.length > 0;
    }),
    [sections, availableAttributes],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    const { active } = event;
    const data = active.data.current;
    if (data?.type === 'connection') {
      setActiveDrag({ type: 'connection', id: String(active.id), connectionId: data.connectionId });
    } else {
      setActiveDrag({ type: 'section', id: String(active.id) });
    }
  }, []);

  const handleDragEnd = React.useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDrag(null);

    const activeData = active.data.current;

    // Connection drag
    if (activeData?.type === 'connection') {
      const connectionId = activeData.connectionId as string;
      const sourceSectionId = activeData.sectionId as string | undefined;
      const sourceGroupId = sourceSectionId?.startsWith('group:') ? sourceSectionId.slice(6) : undefined;

      // Determine target group (if any)
      let targetGroupId: string | undefined;
      if (over) {
        const overData = over.data.current;
        if (overData?.type === 'folder-drop') {
          targetGroupId = overData.groupId as string;
        } else if (String(over.id).startsWith('group:')) {
          targetGroupId = String(over.id).slice(6);
        }
      }

      // Remove from source group if dragged out (to non-folder or different folder)
      if (sourceGroupId && sourceGroupId !== targetGroupId) {
        onRemoveFromGroup?.(sourceGroupId, connectionId);
      }

      // Assign to target group
      if (targetGroupId && targetGroupId !== sourceGroupId) {
        onAssignToGroup?.(targetGroupId, connectionId);
      }
      return;
    }

    // Section reorder
    if (over && activeData?.type === 'section' && active.id !== over.id) {
      const newConfigs = reorderSections(String(active.id), String(over.id));
      onReorderSections(newConfigs);
    }
  }, [reorderSections, onReorderSections, onAssignToGroup, onRemoveFromGroup]);

  const visibleSectionIds = React.useMemo(
    () => visibleSections.map(s => s.config.type),
    [visibleSections],
  );

  // Find dragged connection for overlay
  const draggedConnection = React.useMemo(() => {
    if (activeDrag?.type !== 'connection' || !activeDrag.connectionId) return null;
    return enrichedConnections.find(c => c.connection.id === activeDrag.connectionId) ?? null;
  }, [activeDrag, enrichedConnections]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <Stack gap={1} sx={{ p: 0.5, pb: 2 }}>
        {/* Zone 1: Quick-connect grid -- always visible, cards are draggable */}
        <QuickConnectGrid
          connections={enrichedConnections}
          onRecordAccess={onRecordAccess}
          onToggleFavorite={onToggleFavorite}
          onCreateFolder={onCreateFolder}
        />

        {/* Zone 2: DnD sections -- only when any section has items */}
        {visibleSections.length > 0 && (
          <SortableContext items={visibleSectionIds} strategy={verticalListSortingStrategy}>
            <Stack gap={0.5}>
              {visibleSections.map(section => (
                <DroppableSectionWrapper
                  key={section.config.type}
                  section={section}
                  isDraggingConnection={activeDrag?.type === 'connection'}
                >
                  <SectionRenderer
                    section={section}
                    availableAttributes={availableAttributes}
                    enrichedConnections={enrichedConnections}
                    onToggleCollapse={onToggleCollapse}
                    onRecordAccess={onRecordAccess}
                    onToggleFavorite={onToggleFavorite}
                    onEditFolder={onEditFolder}
                  />
                </DroppableSectionWrapper>
              ))}
            </Stack>
          </SortableContext>
        )}
      </Stack>

      <DragOverlay dropAnimation={null}>
        {draggedConnection && (
          <Card
            variant='outlined'
            sx={{
              p: 1,
              opacity: 0.8,
              boxShadow: 'md',
              width: 200,
              pointerEvents: 'none',
            }}
          >
            <Text size='sm' weight='semibold' noWrap>
              {draggedConnection.displayName}
            </Text>
          </Card>
        )}
      </DragOverlay>
    </DndContext>
  );
};

/**
 * Wraps group sections with a droppable zone when a connection is being dragged.
 */
const DroppableSectionWrapper: React.FC<{
  section: HubSectionData;
  isDraggingConnection: boolean;
  children: React.ReactNode;
}> = ({ section, isDraggingConnection, children }) => {
  const isGroup = section.config.type.startsWith('group:');

  if (!isGroup) return <>{children}</>;

  return (
    <FolderDropZone
      groupId={section.groupId!}
      isDraggingConnection={isDraggingConnection}
    >
      {children}
    </FolderDropZone>
  );
};

const FolderDropZone: React.FC<{
  groupId: string;
  isDraggingConnection: boolean;
  children: React.ReactNode;
}> = ({ groupId, isDraggingConnection, children }) => {
  const { setNodeRef, isOver } = useDroppable({
    id: `folder-drop:${groupId}`,
    data: { type: 'folder-drop', groupId },
  });

  return (
    <Box
      ref={setNodeRef}
      sx={{
        borderRadius: 'sm',
        transition: 'outline-color 0.15s, background-color 0.15s',
        outline: isDraggingConnection ? '2px dashed' : 'none',
        outlineColor: isOver ? 'primary.500' : 'neutral.300',
        backgroundColor: isOver ? 'primary.softBg' : 'transparent',
      }}
    >
      {children}
    </Box>
  );
};

/**
 * Renders a single hub section with its content based on section type.
 */
const SectionRenderer: React.FC<{
  section: HubSectionData;
  availableAttributes: ConnectionAttribute[];
  enrichedConnections: EnrichedConnection[];
  onToggleCollapse: (sectionType: HubSectionType, collapsed: boolean) => void;
  onRecordAccess: (connectionId: string) => void;
  onToggleFavorite: (connectionId: string) => void;
  onEditFolder?: (groupId: string) => void;
}> = ({ section, availableAttributes, enrichedConnections, onToggleCollapse, onRecordAccess, onToggleFavorite, onEditFolder }) => {
  const { config, title, data, groupId, groupColor, groupIcon, emptyHint } = section;
  const isRecent = config.type === 'recent';
  const isBrowse = config.type === 'browse';
  const isGroup = config.type.startsWith('group:');

  return (
    <HubSection
      id={config.type}
      title={title}
      count={isBrowse ? availableAttributes.length : data.length}
      collapsed={config.collapsed}
      onToggleCollapse={() => onToggleCollapse(config.type, !config.collapsed)}
      variant={isBrowse ? 'passthrough' : 'grid'}
      folderColor={groupColor}
      folderIcon={groupIcon}
      onEdit={isGroup && groupId && onEditFolder ? () => onEditFolder(groupId) : undefined}
      showEmpty={isGroup}
      emptyHint={emptyHint}
    >
      {isBrowse ? (
        <GroupBrowser
          connections={enrichedConnections}
          availableAttributes={availableAttributes}
          onConnectionClick={onRecordAccess}
        />
      ) : (
        data.map(enriched => (
          <RowHandler
            key={enriched.connection.id}
            enriched={enriched}
            sectionId={config.type}
            subtitle={isRecent ? formatRelativeTime(enriched.lastAccessed) : undefined}
            showFavorite={config.type === 'favorites'}
            onRecordAccess={() => onRecordAccess(enriched.connection.id)}
            onToggleFavorite={() => onToggleFavorite(enriched.connection.id)}
          />
        ))
      )}
    </HubSection>
  );
};

export default ClusterHub;
