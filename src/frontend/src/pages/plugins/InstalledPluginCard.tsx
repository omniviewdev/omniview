import * as React from 'react';

// material-ui
import Avatar from '@mui/joy/Avatar';
import Box from '@mui/joy/Box';
import Button from '@mui/joy/Button';
import Card from '@mui/joy/Card';
import CardContent from '@mui/joy/CardContent';
import CardActions from '@mui/joy/CardActions';
import Chip from '@mui/joy/Chip';
import IconButton from '@mui/joy/IconButton';
import Stack from '@mui/joy/Stack';
import Tooltip from '@mui/joy/Tooltip';
import Typography from '@mui/joy/Typography';

// icons
import Icon from '@/components/icons/Icon';
import { FaGithub } from 'react-icons/fa6';
import { LuRefreshCcwDot } from 'react-icons/lu';

// hooks
import { usePlugin } from '@/hooks/plugin/usePluginManager';
import { BrowserOpenURL } from '@runtime/runtime';
import UninstallPluginModal from './UninstallPluginModal';

// bindings

type Props = {
  /** The ID of the plugin */
  id: string
}

const InstalledPluginCard: React.FC<Props> = ({ id }) => {
  const [uninstallModalOpen, setUninstallModalOpen] = React.useState(false)

  const { plugin, reload, uninstall } = usePlugin({ id })

  /**
   * Handle opening the link inside the users default browser
   */
  const handleOpenInBrowser = (url: string | undefined) => {
    console.log("opening in browser", url)
    // if the url is a url but doesn't include a protocol, add it
    if (url && !url.includes('://')) {
      url = `https://${url}`
    }

    if (url !== undefined) {
      BrowserOpenURL(url)
    }
  }

  if (plugin.isLoading) {
    return <></>
  }

  if (plugin.isError) {
    return <></>
  }

  return (
    <Card
      id={`plugin-card-${id}`}
      variant="outlined"
      sx={{
        overflow: 'auto',
        position: 'relative',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'start',
        }}
      >
        <Stack direction="row" spacing={2} alignItems="center">
          <Typography level="title-lg">{plugin.data?.metadata.name}</Typography>
          <Chip size="sm" sx={{ borderRadius: 'sm', maxHeight: 20 }} color="primary">
            {plugin.data?.metadata.version}
          </Chip>
        </Stack>
        {plugin.data?.metadata.icon.endsWith('.svg') || plugin.data?.metadata.icon.endsWith('.png') ? (
          <Avatar
            size="md"
            src={plugin.data?.metadata.icon}
            variant='plain'
            sx={{ borderRadius: 4, position: 'absolute', top: 10, right: 10 }} />
        ) : <Icon name={plugin.data?.metadata.icon || ''} size={44} />}
      </Box>
      <CardContent>
        <Typography level="body-sm">{plugin.data?.metadata.description}</Typography>
      </CardContent>
      <CardActions buttonFlex="0 1 120px">
        <Tooltip title="View on GitHub" variant="soft" arrow>
          <IconButton
            variant="outlined"
            color="neutral"
            onClick={() => handleOpenInBrowser(plugin.data?.metadata.repository)}
          >
            <FaGithub />
          </IconButton>
        </Tooltip>

        <Tooltip title="Reload plugin" variant="soft" arrow>
          <IconButton
            variant="outlined"
            color="neutral"
            sx={{ mr: 'auto' }}
            onClick={() => reload()}
          >
            <LuRefreshCcwDot />
          </IconButton>
        </Tooltip>

        <Button
          variant="solid"
          color="primary"
          onClick={() => handleOpenInBrowser(plugin.data?.metadata.website)}
        >
          View
        </Button>
        <Button
          variant="outlined"
          color="neutral"
          onClick={() => setUninstallModalOpen(true)}
        >
          Uninstall
        </Button>
        <UninstallPluginModal open={uninstallModalOpen} onClose={() => setUninstallModalOpen(false)} name={plugin.data?.metadata.name || ""} uninstall={uninstall} />
      </CardActions>
    </Card>
  );
}

export default InstalledPluginCard;
