import React from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useExtensionRegistry } from '@omniviewdev/runtime';
import type { ExtensionPointRegistryContract, ExtensionPointStoreContract, ExtensionContributionRegistration } from '@omniviewdev/runtime';
import { Button, Grid, Spinner, Text } from '@omniviewdev/base-ui';
import type { GridItemProps } from '@omniviewdev/base-ui';
import { LuCheck, LuPencil } from 'react-icons/lu';
import type { HomepageCardProps, HomepageCardMeta } from '@/features/extensions/homepage/types';
import { useHomepageCardSettings } from '@/hooks/homepage/useHomepageCardSettings';
import { DevProcessStatus } from '@omniviewdev/runtime/models';
import { usePluginService } from '@/features/plugins/react/usePluginService';
import { useInstalledPlugins } from '@/hooks/plugin/useInstalledPlugins';
import HomepageCard from './HomepageCard';
import HomepageEmptyState from './HomepageEmptyState';
import Welcome from '../welcome';
import styles from './index.module.css';

// ── Sortable card wrapper ─────────────────────────────────────────────────────

type SortableCardProps = {
  id: string;
  children: React.ReactNode;
  gridSize: GridItemProps['span'];
  isDragging: boolean;
  isEditMode: boolean;
};

const SortableCard: React.FC<SortableCardProps> = ({ id, children, gridSize, isDragging, isEditMode }) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id, disabled: !isEditMode });

  return (
    <Grid.Item
      ref={setNodeRef}
      span={gridSize}
      className={styles.SortableItem}
      data-dragging={isDragging}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      <div
        className={styles.DragHandle}
        data-edit-mode={isEditMode}
        {...(isEditMode && attributes)}
        {...(isEditMode && listeners)}
      >
        {children}
      </div>
    </Grid.Item>
  );
};

// ── Home page ─────────────────────────────────────────────────────────────────

// Expose immutable contribution snapshots, not the registry's mutable store.
function createHomepageStore(registry: ExtensionPointRegistryContract | undefined) {
  type Card = React.FC<HomepageCardProps>;
  let store: ExtensionPointStoreContract<Card> | undefined;
  let version = -1;
  let snapshot: Array<ExtensionContributionRegistration<Card>> = [];

  return {
    subscribe: (notify: () => void) => registry?.subscribe(notify) ?? (() => {
      // No registry means no listener was installed.
    }),
    getSnapshot: () => {
      const current = registry?.getExtensionPoint<Card>('omniview/home/card');
      const currentVersion = current?.version ?? -1;
      if (current !== store || currentVersion !== version) {
        store = current;
        version = currentVersion;
        snapshot = current?.list() ?? [];
      }

      return snapshot;
    },
  };
}

const Home: React.FC = () => {
  const [isEditMode, setIsEditMode] = React.useState(false);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const registry = useExtensionRegistry();
  const contributions = React.useMemo(() => createHomepageStore(registry), [registry]);
  const registrations = React.useSyncExternalStore(contributions.subscribe, contributions.getSnapshot);
  const { ready, plugins } = usePluginService();
  const { plugins: installedPlugins, isLoading, error } = useInstalledPlugins();
  const pluginsPending = !ready || isLoading || installedPlugins.some((plugin) => {
    if (plugin.dev && (
      plugin.devStatus === DevProcessStatus.DevProcessStatusError
      || plugin.devStatus === DevProcessStatus.DevProcessStatusStopped
      || Boolean(plugin.devError)
    )) {
      return false;
    }

    const phase = plugins.get(plugin.id)?.phase;
    return phase !== 'ready' && phase !== 'error';
  });

  const { settings, setOrder, toggleHidden, updateCardConfig, isHidden, getCardConfig } =
    useHomepageCardSettings();

  const regMap = React.useMemo(
    () => Object.fromEntries(registrations.map((r) => [r.id, r])),
    [registrations],
  );

  // Sync order: append newly registered IDs, prune IDs for plugins that are no longer loaded.
  React.useEffect(() => {
    if (pluginsPending || error !== null) {
      return;
    }

    const currentIds = new Set(registrations.map((r) => r.id));
    const newIds = registrations.map((r) => r.id).filter((id) => !settings.order.includes(id));
    const pruned = settings.order.filter((id) => currentIds.has(id));
    if (newIds.length > 0 || pruned.length !== settings.order.length) {
      setOrder([...pruned, ...newIds]);
    }
  }, [registrations, pluginsPending, error, settings.order, setOrder]);

  // Build the ordered list from current registrations and saved order.
  const orderedIds = React.useMemo(
    () => [
      ...settings.order.filter((id) => regMap[id]),
      ...registrations.map((r) => r.id).filter((id) => !settings.order.includes(id)),
    ],
    [settings.order, registrations, regMap],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(typeof event.active.id === 'string' ? event.active.id : null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (over && typeof active.id === 'string' && typeof over.id === 'string' && active.id !== over.id) {
      const oldIndex = orderedIds.indexOf(active.id);
      const newIndex = orderedIds.indexOf(over.id);
      if (oldIndex < 0 || newIndex < 0) {
        return;
      }

      setOrder(arrayMove(orderedIds, oldIndex, newIndex));
    }
  };

  const handleDragCancel = () => {
    setActiveId(null);
  };

  // An empty registry is not an empty installation until startup has settled.
  if (registrations.length === 0) {
    if (error !== null) {
      return (
        <div className={styles.Loading} role='alert'>
          <Text tone='danger'>Unable to load plugin content.</Text>
          <Text size='sm' tone='muted'>{error.message}</Text>
        </div>
      );
    }

    if (pluginsPending) {
      return (
        <div className={styles.Loading} role='status' aria-live='polite'>
          <Spinner size='lg' aria-hidden='true' />
          <Text size='sm' tone='muted'>Loading plugin content…</Text>
        </div>
      );
    }

    return <Welcome />;
  }

  const visibleCount = orderedIds.filter((id) => !isHidden(id)).length;

  // In normal mode exclude hidden IDs from both the SortableContext and Grid to
  // avoid empty cells that disrupt layout. In edit mode all cards are shown.
  const idsToRender = isEditMode ? orderedIds : orderedIds.filter((id) => !isHidden(id));

  const renderCard = (id: string) => {
    const reg = regMap[id];
    if (!reg) {
      return null;
    }

    const meta = reg.meta as HomepageCardMeta | undefined;
    const defaultConfig = meta?.defaultConfig ?? { sections: [], maxItems: 5 };
    const config = getCardConfig(id, defaultConfig);
    return (
      <HomepageCard
        registration={reg}
        config={config}
        isHidden={isHidden(id)}
        isEditMode={isEditMode}
        onToggleHidden={() => {
          toggleHidden(id); 
        }}
        onConfigChange={(cfg) => {
          updateCardConfig(id, cfg); 
        }}
      />
    );
  };

  const getGridSize = (id: string): GridItemProps['span'] => {
    const meta = (regMap[id]?.meta as HomepageCardMeta | undefined);
    const width = meta?.defaultWidth ?? 'medium';
    return width === 'small' ? { xs: 12, sm: 6, lg: 3 }
      : width === 'large' ? { xs: 12 }
        : { xs: 12, sm: 6, lg: 4 };
  };

  return (
    <div className={styles.Root}>
      {/* Page header */}
      <div className={styles.Header}>
        <Text size='lg' weight='semibold'>Home</Text>
        <Button
          size='sm'
          variant={isEditMode ? 'solid' : 'outline'}
          color='brand'
          startDecorator={isEditMode ? <LuCheck size={16} /> : <LuPencil size={16} />}
          onClick={() => {
            setIsEditMode((v) => !v); 
          }}
        >
          {isEditMode ? 'Done' : 'Edit Layout'}
        </Button>
      </div>

      {/* Cards grid */}
      {visibleCount === 0 && !isEditMode ? (
        <HomepageEmptyState />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext items={idsToRender} strategy={rectSortingStrategy}>
            <Grid columns={12} spacing={4} className={styles.Grid}>
              {idsToRender.map((id) => (
                <SortableCard
                  key={id}
                  id={id}
                  gridSize={getGridSize(id)}
                  isDragging={activeId === id}
                  isEditMode={isEditMode}
                >
                  {renderCard(id)}
                </SortableCard>
              ))}
            </Grid>
          </SortableContext>

          <DragOverlay>
            {activeId && (
              <div className={styles.DragOverlay}>
                {renderCard(activeId)}
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
};

Home.displayName = 'Home';

export default Home;
