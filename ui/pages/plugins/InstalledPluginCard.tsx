import * as React from 'react';

// Material-ui
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { Button, IconButton } from '@omniviewdev/ui/buttons';
import { Tooltip } from '@omniviewdev/ui/overlays';
import { Avatar, Chip, Card } from '@omniviewdev/ui';

// Icons
import Icon from '@/components/icons/Icon';
import { FaGithub } from 'react-icons/fa6';
import { LuAtom, LuRefreshCcwDot, LuView } from 'react-icons/lu';

// Hooks
import { usePlugin } from '@/hooks/plugin/usePluginManager';
import { BrowserOpenURL } from '@omniviewdev/runtime/runtime';
import UninstallPluginModal from './UninstallPluginModal';
import PluginUpdateButton from './PluginUpdateButton';
import DevModeSection from './DevModeSection';

type Props = {
  /** The ID of the plugin */
  id: string;
};

const IsImage = /^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$|\.(gif|jpe?g|tiff?|png|webp|bmp)$/i;

const InstalledPluginCard: React.FC<Props> = ({ id }) => {
  const [uninstallModalOpen, setUninstallModalOpen] = React.useState(false);

  const { plugin, reload, uninstall } = usePlugin({ id });

  const handleOpenInBrowser = (url: string | undefined) => {
    if (url && !url.includes('://')) {
      url = `https://${url}`;
    }
    if (url !== undefined) {
      BrowserOpenURL(url);
    }
  };

  if (plugin.isLoading || plugin.isError) {
    return null;
  }

  const isDevMode = !!plugin.data?.devMode;

  return (
    <Card
      sx={{
        overflow: 'hidden',
        position: 'relative',
        border: '1px solid',
        borderColor: 'divider',
      }}
    >
      {(plugin.data?.phase === 'Starting' || plugin.data?.phase === 'Validating' || plugin.data?.phase === 'Building') && (
        <CircularProgress
          size={48}
          thickness={8}
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 1,
          }}
        />
      )}

      <Box
        sx={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
          opacity: (plugin.data?.phase === 'Starting' || plugin.data?.phase === 'Validating' || plugin.data?.phase === 'Building') ? 0.2 : 1,
          transition: 'opacity 0.3s ease-in-out',
        }}
      >
        {/* Header: name, version, dev badge, icon */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', minWidth: 0, pr: 5 }}>
            <Text weight="semibold" size="lg" sx={{ whiteSpace: 'nowrap' }}>
              {plugin.data?.metadata.name}
            </Text>
            <Chip
              size="xs"
              color="neutral"
              emphasis="outline"
              shape="rounded"
              label={plugin.data?.metadata.version ?? ''}
            />
            {isDevMode && (
              <Tooltip content={<Text weight="semibold" size="sm">{plugin.data?.devPath}</Text>}>
                <Chip
                  size="xs"
                  color="warning"
                  emphasis="outline"
                  shape="rounded"
                  icon={<LuAtom size={12} />}
                  label="Dev Mode"
                />
              </Tooltip>
            )}
          </Box>
          {plugin.data?.metadata.icon ? (
            IsImage.test(plugin.data.metadata.icon) ? (
              <Avatar
                size="md"
                src={plugin.data.metadata.icon}
                sx={{ borderRadius: 4, position: 'absolute', top: 10, right: 10 }}
              />
            ) : (
              <Icon name={plugin.data.metadata.icon} size={30} />
            )
          ) : null}
        </Box>

        {/* Description */}
        <Box sx={{ minHeight: 36 }}>
          <Text
            size="sm"
            sx={{
              display: '-webkit-box',
              overflow: 'hidden',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: 2,
            }}
          >
            {plugin.data?.metadata.description}
          </Text>
        </Box>

        {/* Category & tags */}
        {(plugin.data?.metadata as any)?.category && (
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Chip
              size="xs"
              color="neutral"
              emphasis="outline"
              shape="rounded"
              label={(plugin.data?.metadata as any).category}
            />
          </Stack>
        )}

        {/* Dev server section */}
        {isDevMode && (
          <DevModeSection pluginId={id} devPath={plugin.data?.devPath ?? ''} />
        )}

        {/* Actions row */}
        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', alignItems: 'center' }}>
          <Tooltip content="View on GitHub">
            <IconButton
              emphasis="outline"
              color="neutral"
              onClick={() => handleOpenInBrowser(plugin.data?.metadata.repository)}
            >
              <FaGithub />
            </IconButton>
          </Tooltip>

          <Tooltip content="Reload plugin">
            <IconButton
              emphasis="outline"
              color="neutral"
              sx={{ mr: 'auto' }}
              onClick={async () => reload()}
            >
              <LuRefreshCcwDot />
            </IconButton>
          </Tooltip>

          <Tooltip content="View plugin">
            <IconButton
              emphasis="outline"
              color="neutral"
              onClick={() => handleOpenInBrowser(plugin.data?.metadata.website)}
            >
              <LuView />
            </IconButton>
          </Tooltip>

          <Button
            emphasis="outline"
            color="neutral"
            onClick={() => setUninstallModalOpen(true)}
          >
            Uninstall
          </Button>

          {/* Hide update button for dev mode plugins — they aren't installed via marketplace */}
          {!isDevMode && (
            <PluginUpdateButton
              installed
              currentVersion={plugin.data?.metadata.version || ''}
              pluginID={id}
            />
          )}

          <UninstallPluginModal
            open={uninstallModalOpen}
            onClose={() => setUninstallModalOpen(false)}
            name={plugin.data?.metadata.name ?? ''}
            uninstall={uninstall}
          />
        </Stack>
      </Box>
    </Card>
  );
};

export default InstalledPluginCard;
