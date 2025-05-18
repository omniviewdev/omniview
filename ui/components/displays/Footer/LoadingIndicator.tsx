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
          [meta.id]: `Installing plugin '${meta.name}' in development mode`
        }
      })
    });


    const cancelInstallStart = EventsOn('plugin/update_started', (id: string, version: string) => {
      setLoading((prev) => {
        return {
          ...prev,
          [id]: `Updating plugin '${id}' to '${version}`
        }
      })
    });

    // Set up watchers for plugin reload and install events
    const cancelReloadStart = EventsOn('plugin/dev_reload_start', (meta: config.PluginMeta) => {
      setLoading((prev) => {
        return {
          ...prev,
          [meta.id]: `Reloading plugin '${meta.name}'`
        }
      })
    })

    const cancelReloadError = EventsOn('plugin/dev_reload_error', (meta: config.PluginMeta) => {
      setLoading((prev) => {
        return {
          ...prev,
          [meta.id]: ''
        }
      })
    });

    const cancelReloadComplete = EventsOn('plugin/dev_reload_complete', (meta: config.PluginMeta) => {
      setLoading((prev) => {
        return {
          ...prev,
          [meta.id]: ''
        }
      })
    })

    const cancelInstallComplete = EventsOn('plugin/install_complete', (meta: config.PluginMeta) => {
      console.log("got install complete", loading)
      setLoading((prev) => {
        return {
          ...prev,
          [meta.id]: ''
        }
      })
    })

    const cancelInstallFinished = EventsOn('plugin/install_finished', (meta: config.PluginMeta) => {
      setLoading((prev) => {
        return {
          ...prev,
          [meta.id]: ''
        }
      })
    })

    const cancelInstallError = EventsOn('plugin/install_error', (meta: config.PluginMeta) => {
      setLoading((prev) => {
        return {
          ...prev,
          [meta.id]: ''
        }
      })
    })

    return () => {
      // Cleanup watchers
      cancelInstallStart()
      cancelDevInstallStart()
      cancelReloadStart()
      cancelReloadError()
      cancelReloadComplete()
      cancelInstallComplete()
      cancelInstallError()
      cancelInstallFinished()
    };
  }, [loading, setLoading])

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
