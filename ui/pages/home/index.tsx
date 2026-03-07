import React from 'react';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Button from '@mui/material/Button';
import EditIcon from '@mui/icons-material/Edit';
import CheckIcon from '@mui/icons-material/Check';
import { useExtensionPoint } from '@omniviewdev/runtime';
import { EventsOn } from '@omniviewdev/runtime/runtime';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import type { HomepageCardProps, HomepageCardMeta } from '@/features/extensions/homepage/types';
import { useHomepageCardSettings } from '@/hooks/homepage/useHomepageCardSettings';
import HomepageCard from './HomepageCard';
import HomepageEmptyState from './HomepageEmptyState';
import Welcome from '../welcome';

const Home: React.FC = () => {
  const [isEditMode, setIsEditMode] = React.useState(false);
  // Force re-render when new plugins load
  const [, forceUpdate] = React.useReducer((x: number) => x + 1, 0);

  React.useEffect(() => {
    const cleanup = EventsOn('core/window/recalc_routes', forceUpdate);
    return () => cleanup();
  }, []);

  const ep = useExtensionPoint<HomepageCardProps>('omniview/home/card');
  const registrations = ep?.list() ?? [];

  const { settings, setOrder, toggleHidden, updateCardConfig, isHidden, getCardConfig } =
    useHomepageCardSettings();

  // Sync any newly registered card IDs into the persisted order (append new ones)
  const registrationIds = registrations.map((r) => r.id).join(',');
  React.useEffect(() => {
    const newIds = registrations.map((r) => r.id).filter((id) => !settings.order.includes(id));
    if (newIds.length > 0) {
      setOrder([...settings.order, ...newIds]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registrationIds]);

  // If no cards are registered, fall back to the original Welcome page
  if (registrations.length === 0) {
    return <Welcome />;
  }

  // Build the ordered list: persisted order filtered to known IDs, plus any unseen IDs appended
  const regMap = Object.fromEntries(registrations.map((r) => [r.id, r]));
  const orderedIds = [
    ...settings.order.filter((id) => regMap[id]),
    ...registrations.map((r) => r.id).filter((id) => !settings.order.includes(id)),
  ];

  const moveUp = (index: number) => {
    if (index === 0) return;
    const next = [...orderedIds];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    setOrder(next);
  };

  const moveDown = (index: number) => {
    if (index === orderedIds.length - 1) return;
    const next = [...orderedIds];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    setOrder(next);
  };

  const visibleCount = orderedIds.filter((id) => !isHidden(id)).length;

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'auto',
        p: 2,
        gap: 2,
      }}
    >
      {/* Page header */}
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Text size="lg" weight="semibold">
          Home
        </Text>
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
        <Grid container spacing={2} alignItems="stretch">
          {orderedIds.map((id, index) => {
            const reg = regMap[id];
            if (!reg) return null;
            const meta = reg.meta as HomepageCardMeta | undefined;
            const defaultConfig = meta?.defaultConfig ?? { sections: [], maxItems: 5 };
            const config = getCardConfig(id, defaultConfig);
            const width = meta?.defaultWidth ?? 'medium';
            const gridSize = width === 'small' ? { xs: 12, sm: 6, lg: 3 }
              : width === 'large' ? { xs: 12 }
              : { xs: 12, sm: 6, lg: 4 };

            return (
              <Grid key={id} size={gridSize} sx={{ display: 'flex' }}>
                <Box sx={{ width: '100%' }}>
                  <HomepageCard
                    registration={reg}
                    config={config}
                    isHidden={isHidden(id)}
                    isEditMode={isEditMode}
                    isFirst={index === 0}
                    isLast={index === orderedIds.length - 1}
                    onMoveUp={() => moveUp(index)}
                    onMoveDown={() => moveDown(index)}
                    onToggleHidden={() => toggleHidden(id)}
                    onConfigChange={(cfg) => updateCardConfig(id, cfg)}
                  />
                </Box>
              </Grid>
            );
          })}
        </Grid>
      )}
    </Box>
  );
};

Home.displayName = 'Home';

export default Home;
