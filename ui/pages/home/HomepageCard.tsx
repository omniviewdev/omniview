import React, { useMemo } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import SettingsIcon from '@mui/icons-material/Settings';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary';
import { LuRotateCw, LuTriangleAlert } from 'react-icons/lu';
import { Text } from '@omniviewdev/ui/typography';
import { Stack } from '@omniviewdev/ui/layout';
import MuiButton from '@mui/material/Button';
import { PluginContext } from '@omniviewdev/runtime';
import { PluginMeta } from '@omniviewdev/runtime/models';
import type { ExtensionContributionRegistration } from '@omniviewdev/runtime';
import type { HomepageCardProps, HomepageCardMeta, HomepageCardConfig } from '@/features/extensions/homepage/types';
import HomepageCardConfigPopover from './HomepageCardConfigPopover';

/**
 * Card-specific error fallback that fills the card content area with a
 * centered, visually integrated error state.
 */
function CardErrorFallback({ error, resetErrorBoundary, label }: FallbackProps & { label: string }) {
  return (
    <Stack
      alignItems="center"
      justifyContent="center"
      gap={1.5}
      sx={{
        height: '100%',
        minHeight: 120,
        px: 3,
        py: 2,
        textAlign: 'center',
      }}
    >
      <Box
        sx={{
          width: 40,
          height: 40,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'rgba(var(--mui-palette-error-mainChannel) / 0.08)',
        }}
      >
        <LuTriangleAlert size={20} color="var(--mui-palette-error-main)" />
      </Box>
      <Stack alignItems="center" gap={0.5}>
        <Text size="sm" weight="semibold" color="text.primary">
          {label} failed to load
        </Text>
        <Text size="xs" color="text.secondary" sx={{ maxWidth: 260 }}>
          {error.message.length > 120 ? error.message.slice(0, 120) + '…' : error.message}
        </Text>
      </Stack>
      <MuiButton
        size="small"
        variant="outlined"
        color="inherit"
        onClick={resetErrorBoundary}
        startIcon={<LuRotateCw size={13} />}
        sx={{ textTransform: 'none', fontSize: 12 }}
      >
        Retry
      </MuiButton>
    </Stack>
  );
}

type Props = {
  registration: ExtensionContributionRegistration<React.FC<HomepageCardProps>>;
  config: HomepageCardConfig;
  isHidden: boolean;
  isEditMode: boolean;
  onToggleHidden: () => void;
  onConfigChange: (config: HomepageCardConfig) => void;
};

const HomepageCard: React.FC<Props> = ({
  registration,
  config,
  isHidden,
  isEditMode,
  onToggleHidden,
  onConfigChange,
}) => {
  const [configAnchor, setConfigAnchor] = React.useState<HTMLElement | null>(null);

  const providerValue = useMemo(() => ({
    pluginId: registration.plugin,
    meta: new PluginMeta(),
    settings: {},
  }), [registration.plugin]);

  // In normal mode, hidden cards are not rendered
  if (isHidden && !isEditMode) {
    return null;
  }

  const meta = registration.meta as HomepageCardMeta | undefined;
  const Component = registration.value;

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        overflow: 'hidden',
        opacity: isHidden && isEditMode ? 0.45 : 1,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      {/* Edit-mode toolbar */}
      {isEditMode && (
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="flex-end"
          sx={{ px: 1, py: 0.5, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}
        >
          <Stack direction="row" alignItems="center" gap={0.5}>
            {isHidden && (
              <Chip label="Hidden" size="small" sx={{ height: 18, fontSize: 10 }} />
            )}
            <Tooltip title={isHidden ? 'Show card' : 'Hide card'}>
              <IconButton size="small" onClick={onToggleHidden}>
                {isHidden ? (
                  <VisibilityIcon sx={{ fontSize: 16 }} />
                ) : (
                  <VisibilityOffIcon sx={{ fontSize: 16 }} />
                )}
              </IconButton>
            </Tooltip>
            {meta && (
              <Tooltip title="Card settings">
                <IconButton size="small" onClick={(e) => setConfigAnchor(e.currentTarget)}>
                  <SettingsIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        </Stack>
      )}

      {/* Card icon header */}
      <Box sx={{ display: 'flex', justifyContent: 'center', pt: 2, pb: 0.5 }}>
        {meta?.icon ? (
          <Tooltip title={registration.label}>
            <Box sx={{ display: 'flex', alignItems: 'center', opacity: 0.7 }}>
              <meta.icon size={48} />
            </Box>
          </Tooltip>
        ) : (
          <Text size="sm" weight="semibold">{registration.label}</Text>
        )}
      </Box>

      {/* Card content — wrapped in per-card error boundary so a single
          plugin crash doesn't take down the entire homepage */}
      <Box sx={{ flex: 1, overflow: 'auto', px: 1.5, pb: 1.5 }}>
        <ErrorBoundary
          FallbackComponent={(props) => (
            <CardErrorFallback {...props} label={registration.label ?? registration.plugin} />
          )}
          resetKeys={[registration.id]}
        >
          <PluginContext.Provider value={providerValue}>
            <Component pluginID={registration.plugin} config={config} />
          </PluginContext.Provider>
        </ErrorBoundary>
      </Box>

      {/* Config popover */}
      {meta && (
        <HomepageCardConfigPopover
          anchorEl={configAnchor}
          onClose={() => setConfigAnchor(null)}
          meta={meta}
          config={config}
          onConfigChange={(next) => {
            onConfigChange(next);
            setConfigAnchor(null);
          }}
        />
      )}
    </Box>
  );
};

export default HomepageCard;
