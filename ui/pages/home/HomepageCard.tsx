import React from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import SettingsIcon from '@mui/icons-material/Settings';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { Text } from '@omniviewdev/ui/typography';
import { Stack } from '@omniviewdev/ui/layout';
import type { Registration } from '@omniviewdev/runtime';
import type { HomepageCardProps, HomepageCardMeta, HomepageCardConfig } from '@/features/extensions/homepage/types';
import HomepageCardConfigPopover from './HomepageCardConfigPopover';

type Props = {
  registration: Registration<HomepageCardProps>;
  config: HomepageCardConfig;
  isHidden: boolean;
  isEditMode: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleHidden: () => void;
  onConfigChange: (config: HomepageCardConfig) => void;
};

const HomepageCard: React.FC<Props> = ({
  registration,
  config,
  isHidden,
  isEditMode,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onToggleHidden,
  onConfigChange,
}) => {
  const [configAnchor, setConfigAnchor] = React.useState<HTMLElement | null>(null);

  // In normal mode, hidden cards are not rendered
  if (isHidden && !isEditMode) {
    return null;
  }

  const meta = registration.meta as HomepageCardMeta | undefined;
  const Component = registration.component as unknown as React.FC<HomepageCardProps>;

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
      {/* Card header */}
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}
      >
        <Stack direction="row" alignItems="center" gap={1}>
          {meta?.icon ? (
            <Tooltip title={registration.label}>
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <meta.icon size={18} />
              </Box>
            </Tooltip>
          ) : (
            <Text size="sm" weight="semibold">
              {registration.label}
            </Text>
          )}
          {isHidden && isEditMode && (
            <Chip label="Hidden" size="small" sx={{ height: 18, fontSize: 10 }} />
          )}
        </Stack>

        <Stack direction="row" alignItems="center" gap={0.5}>
          {isEditMode && (
            <>
              <Tooltip title="Move up">
                <span>
                  <IconButton size="small" onClick={onMoveUp} disabled={isFirst}>
                    <ArrowUpwardIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Move down">
                <span>
                  <IconButton size="small" onClick={onMoveDown} disabled={isLast}>
                    <ArrowDownwardIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title={isHidden ? 'Show card' : 'Hide card'}>
                <IconButton size="small" onClick={onToggleHidden}>
                  {isHidden ? (
                    <VisibilityIcon sx={{ fontSize: 16 }} />
                  ) : (
                    <VisibilityOffIcon sx={{ fontSize: 16 }} />
                  )}
                </IconButton>
              </Tooltip>
            </>
          )}

          {meta && (
            <Tooltip title="Card settings">
              <IconButton size="small" onClick={(e) => setConfigAnchor(e.currentTarget)}>
                <SettingsIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
      </Stack>

      {/* Card content */}
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        <Component pluginID={registration.plugin} config={config} />
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
