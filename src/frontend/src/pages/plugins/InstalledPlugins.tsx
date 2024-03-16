import React from 'react'

// material-ui
import Grid from '@mui/joy/Grid'
import Typography from '@mui/joy/Typography'
import Stack from '@mui/joy/Stack'
import Button from '@mui/joy/Button'

// components
import InstalledPluginCard from './InstalledPluginCard'

// icons
import { LuFile } from 'react-icons/lu'

// hooks
import { usePluginManager } from '@/hooks/plugin/usePluginManager'

type Props = {}

/**
 * Show the currently installed plugins.
 */
const InstalledPlugins: React.FC<Props> = () => {
  const { plugins, promptInstallFromPath } = usePluginManager()

  if (plugins.isLoading) {
    return <div>Loading...</div>
  }
  if (plugins.isError) {
    return <div>Error: {plugins.error.message}</div>
  }

  return (
    <Grid container spacing={4} p={4}>
      <Grid xs={12} pb={2}>
        <Stack direction="row" spacing={2} alignItems="center" justifyContent={'space-between'}>
          <Typography level="h2">Installed Plugins</Typography>
          <Button
            variant="outlined"
            color="primary"
            startDecorator={<LuFile />}
            onClick={() => promptInstallFromPath()}
          >
            Install From Location
          </Button>
        </Stack>
      </Grid>
      {plugins.data?.map((plugin) => (
        <Grid key={plugin.id} xs={12} md={6} xl={4} >
          <InstalledPluginCard key={plugin.id} {...plugin} />
        </Grid>
      ))}
    </Grid>
  )

}

export default InstalledPlugins
