import React from 'react'

import {
  CircularProgress,
  Stack,
  Typography,
} from '@mui/joy';
import { EventsOn } from '@omniviewdev/runtime/runtime';
import { config } from '@omniviewdev/runtime/models';

const LoadingIndicator: React.FC = () => {
  const [loading, setLoading] = React.useState<Record<string, string>>({})

  const loadingMessage = () => {
    for (const key in loading) {
      if (!!loading[key]) {
        return loading[key]
      }
    }
  }

  React.useEffect(() => {
    const cancelDevInstallStart = EventsOn('plugin/dev_install_start', (meta: config.PluginMeta) => {
      setLoading((prev) => {
        return {
          ...prev,
          [meta.name]: `Installing plugin '${meta.name}' in development mode`
        }
      })
    });

    // Set up watchers for plugin reload and install events
    const cancelReloadStart = EventsOn('plugin/dev_reload_start', (meta: config.PluginMeta) => {
      setLoading((prev) => {
        return {
          ...prev,
          [meta.name]: `Reloading plugin '${meta.name}'`
        }
      })
    })

    const cancelReloadError = EventsOn('plugin/dev_reload_error', (meta: config.PluginMeta) => {
      setLoading((prev) => {
        return {
          ...prev,
          [meta.name]: ''
        }
      })
    });

    const cancelReloadComplete = EventsOn('plugin/dev_reload_complete', (meta: config.PluginMeta) => {
      setLoading((prev) => {
        return {
          ...prev,
          [meta.name]: ''
        }
      })
    })

    const cancelInstallComplete = EventsOn('plugin/install_complete', (meta: config.PluginMeta) => {
      setLoading((prev) => {
        return {
          ...prev,
          [meta.name]: ''
        }
      })
    })

    return () => {
      // Cleanup watchers
      cancelDevInstallStart()
      cancelReloadStart()
      cancelReloadError()
      cancelReloadComplete()
      cancelInstallComplete()
    };
  }, [])

  const message = loadingMessage()

  if (!message) {
    return <></>
  }

  return (
    <Stack direction={'row'} alignItems={'center'} spacing={1}>
      <Typography level='body-xs' fontSize={11} fontWeight={300} textColor='neutral'>{message}</Typography>
      <CircularProgress size="sm" color="primary" sx={{
        "--CircularProgress-size": "12px",
        "--CircularProgress-trackThickness": "3px",
        "--CircularProgress-progressThickness": "2px"
      }} />
    </Stack>
  )
}

export default LoadingIndicator
