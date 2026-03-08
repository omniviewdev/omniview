import React from 'react';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Button from '@mui/material/Button';
import EditIcon from '@mui/icons-material/Edit';
import CheckIcon from '@mui/icons-material/Check';
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
import { useExtensionPoint } from '@omniviewdev/runtime';
import { EventsOn } from '@omniviewdev/runtime/runtime';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import type { HomepageCardProps, HomepageCardMeta } from '@/features/extensions/homepage/types';
import { useHomepageCardSettings } from '@/hooks/homepage/useHomepageCardSettings';
import HomepageCard from './HomepageCard';
import HomepageEmptyState from './HomepageEmptyState';
import Welcome from '../welcome';

// ── Sortable card wrapper ─────────────────────────────────────────────────────

type SortableCardProps = {
  id: string;
  children: React.ReactNode;
  gridSize: Record<string, number>;
  isDragging: boolean;
  isEditMode: boolean;
};

const SortableCard: React.FC<SortableCardProps> = ({ id, children, gridSize, isDragging, isEditMode }) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id, disabled: !isEditMode });

  return (
    <Grid
      ref={setNodeRef}
      size={gridSize}
      sx={{
        display: 'flex',
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.3 : 1,
        zIndex: isDragging ? 0 : 'auto',
      }}
    >
      <Box
        sx={{
          width: '100%',
          ...(isEditMode && { cursor: 'grab', '&:active': { cursor: 'grabbing' } }),
        }}
        {...(isEditMode && attributes)}
        {...(isEditMode && listeners)}
      >
        {children}
      </Box>
    </Grid>
  );
};

// ── Home page ─────────────────────────────────────────────────────────────────

const Home: React.FC = () => {
  const [isEditMode, setIsEditMode] = React.useState(false);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [, forceUpdate] = React.useReducer((x: number) => x + 1, 0);

  React.useEffect(() => {
    const cleanup = EventsOn('core/window/recalc_routes', forceUpdate);
    return () => cleanup();
  }, []);

  const ep = useExtensionPoint<HomepageCardProps>('omniview/home/card');
  const registrations = ep?.list() ?? [];

  const { settings, setOrder, toggleHidden, updateCardConfig, isHidden, getCardConfig } =
    useHomepageCardSettings();

  // Stable primitive dep: join IDs so the memo only recomputes when the set of registered IDs changes,
  // not on every render where the `registrations` array reference is new.
  const registrationIds = registrations.map((r) => r.id).join(',');

  const regMap = React.useMemo(
    () => Object.fromEntries(registrations.map((r) => [r.id, r])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [registrationIds],
  );

  // Sync order: append newly registered IDs, prune IDs for plugins that are no longer loaded.
  React.useEffect(() => {
    const currentIds = new Set(registrations.map((r) => r.id));
    const newIds = registrations.map((r) => r.id).filter((id) => !settings.order.includes(id));
    const pruned = settings.order.filter((id) => currentIds.has(id));
    if (newIds.length > 0 || pruned.length !== settings.order.length) {
      setOrder([...pruned, ...newIds]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registrationIds]);

  // Build ordered list — memoized; only recalculates when order or known IDs change
  const orderedIds = React.useMemo(
    () => [
      ...settings.order.filter((id) => regMap[id]),
      ...registrations.map((r) => r.id).filter((id) => !settings.order.includes(id)),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.order, registrationIds],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = orderedIds.indexOf(active.id as string);
      const newIndex = orderedIds.indexOf(over.id as string);
      setOrder(arrayMove(orderedIds, oldIndex, newIndex));
    }
  };

  // If no cards are registered, fall back to the original Welcome page
  if (registrations.length === 0) {
    return <Welcome />;
  }

  const visibleCount = orderedIds.filter((id) => !isHidden(id)).length;

  // In normal mode exclude hidden IDs from both the SortableContext and Grid to
  // avoid empty cells that disrupt layout. In edit mode all cards are shown.
  const idsToRender = isEditMode ? orderedIds : orderedIds.filter((id) => !isHidden(id));

  const renderCard = (id: string) => {
    const reg = regMap[id];
    if (!reg) return null;
    const meta = reg.meta as HomepageCardMeta | undefined;
    const defaultConfig = meta?.defaultConfig ?? { sections: [], maxItems: 5 };
    const config = getCardConfig(id, defaultConfig);
    return (
      <HomepageCard
        registration={reg}
        config={config}
        isHidden={isHidden(id)}
        isEditMode={isEditMode}
        onToggleHidden={() => toggleHidden(id)}
        onConfigChange={(cfg) => updateCardConfig(id, cfg)}
      />
    );
  };

  const getGridSize = (id: string) => {
    const meta = (regMap[id]?.meta as HomepageCardMeta | undefined);
    const width = meta?.defaultWidth ?? 'medium';
    return width === 'small' ? { xs: 12, sm: 6, lg: 3 }
      : width === 'large' ? { xs: 12 }
      : { xs: 12, sm: 6, lg: 4 };
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto', p: 2, gap: 2 }}>
      {/* Page header */}
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Text size="lg" weight="semibold">Home</Text>
        <Button
          size="small"
          variant={isEditMode ? 'contained' : 'outlined'}
          startIcon={isEditMode ? <CheckIcon /> : <EditIcon />}
          onClick={() => setIsEditMode((v) => !v)}
        >
          {isEditMode ? 'Done' : 'Edit Layout'}
        </Button>
      </Stack>

      {/* Cards grid */}
      {visibleCount === 0 && !isEditMode ? (
        <HomepageEmptyState />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={idsToRender} strategy={rectSortingStrategy}>
            <Grid container spacing={2} alignItems="stretch">
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
              <Box sx={{ opacity: 0.85, pointerEvents: 'none', boxShadow: 6, borderRadius: 2 }}>
                {renderCard(activeId)}
              </Box>
            )}
          </DragOverlay>
        </DndContext>
      )}
    </Box>
  );
};

Home.displayName = 'Home';

export default Home;
