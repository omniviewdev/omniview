import * as React from 'react';

// Material-ui
import {
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  CardActions,
  CircularProgress,
  Chip,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/joy';

// Icons
import Icon from '@/components/icons/Icon';
import { FaGithub } from 'react-icons/fa6';
import { LuAtom, LuRefreshCcwDot } from 'react-icons/lu';

// Hooks
import { usePlugin } from '@/hooks/plugin/usePluginManager';
import { BrowserOpenURL } from '@omniviewdev/runtime/runtime';
import UninstallPluginModal from './UninstallPluginModal';

// Bindings

type Props = {
  /** The ID of the plugin */
  id: string;
};

const IsImage = /^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$|\.(gif|jpe?g|tiff?|png|webp|bmp)$/i;

// Assuming you

const InstalledPluginCard: React.FC<Props> = ({ id }) => {
  const [uninstallModalOpen, setUninstallModalOpen] = React.useState(false);

  const { plugin, reload, uninstall } = usePlugin({ id });

  /**
   * Handle opening the link inside the users default browser
   */
  const handleOpenInBrowser = (url: string | undefined) => {
    console.log('opening in browser', url);
    // If the url is a url but doesn't include a protocol, add it
    if (url && !url.includes('://')) {
      url = `https://${url}`;
    }

    if (url !== undefined) {
      BrowserOpenURL(url);
    }
  };

  if (plugin.isLoading) {
    return <></>;
  }

  if (plugin.isError) {
    return <></>;
  }

  return (
    <Card
      id={`plugin-card-${id}`}
      variant='outlined'
      sx={{
        overflow: 'auto',
        position: 'relative',
      }}
    >
      {plugin.data?.loading && <CircularProgress size={'lg'} thickness={8} sx={{
        position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
      }} />}
      <div style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        opacity: plugin.data?.loading ? 0.2 : 1,
        transition: 'opacity 0.3s ease-in-out',
      }}>
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'start',
          }}
        >
          <Stack direction='row' spacing={2} alignItems='center'>
            <Typography level='title-lg'>{plugin.data?.metadata.name}</Typography>
            <Chip size='sm' sx={{ borderRadius: 'sm', maxHeight: 20 }} color='neutral'>
              {plugin.data?.metadata.version}
            </Chip>
            {plugin.data?.devMode &&
              <Tooltip
                sx={{ p: 1 }}
                title={
                  <Typography level='title-sm'>
                    {plugin.data?.devPath}
                  </Typography>
                }
                variant='soft'
                color='warning'
                arrow
              >
                <Chip
                  size='sm'
                  sx={{ borderRadius: 'sm', maxHeight: 20 }}
                  color='warning'
                  variant='outlined'
                  startDecorator={
                    <LuAtom />
                  }
                >
                  Dev Mode
                </Chip>
              </Tooltip>
            }
          </Stack>
          {plugin.data?.metadata.icon && IsImage.test(plugin.data?.metadata.icon) ? (
            <Avatar
              size='md'
              src={plugin.data?.metadata.icon}
              variant='plain'
              sx={{
                borderRadius: 4, position: 'absolute', top: 10, right: 10,
              }} />
          ) : <Icon name={plugin.data?.metadata.icon ?? ''} size={30} />}
        </Box>
        <CardContent sx={{ minHeight: 42 }}>
          <Typography
            level='body-sm'
            sx={{
              display: '-webkit-box',
              overflow: 'hidden',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: 2,
            }}
          >{plugin.data?.metadata.description}</Typography>
        </CardContent>
        <CardActions buttonFlex='0 1 120px'>
          <Tooltip title='View on GitHub' variant='soft' arrow>
            <IconButton
              variant='outlined'
              color='neutral'
              onClick={() => {
                handleOpenInBrowser(plugin.data?.metadata.repository);
              }}
            >
              <FaGithub />
            </IconButton>
          </Tooltip>

          <Tooltip title='Reload plugin' variant='soft' arrow>
            <IconButton
              variant='outlined'
              color='neutral'
              sx={{ mr: 'auto' }}
              onClick={async () => reload()}
            >
              <LuRefreshCcwDot />
            </IconButton>
          </Tooltip>

          <Button
            variant='solid'
            color='primary'
            onClick={() => {
              handleOpenInBrowser(plugin.data?.metadata.website);
            }}
          >
            View
          </Button>
          <Button
            variant='outlined'
            color='neutral'
            onClick={() => {
              setUninstallModalOpen(true);
            }}
          >
            Uninstall
          </Button>
          <UninstallPluginModal open={uninstallModalOpen} onClose={() => {
            setUninstallModalOpen(false);
          }} name={plugin.data?.metadata.name ?? ''} uninstall={uninstall} />
        </CardActions>
      </div>
    </Card>
  );
};

export default InstalledPluginCard;
