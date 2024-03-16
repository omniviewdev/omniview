import React from 'react'

import { ListPlugins } from '@api/plugin/pluginManager'

import {
  useQuery,
} from '@tanstack/react-query'
import { Grid, Typography } from '@mui/joy'
import InstalledPluginCard from './InstalledPluginCard'

const InstalledPlugins: React.FC = () => {
  const query = useQuery({ queryKey: ['INSTALLED_PLUGINS'], queryFn: ListPlugins })

  if (query.isLoading) {
    return <div>Loading...</div>
  }
  if (query.isError) {
    return <div>Error: {query.error.message}</div>
  }

  return (
    <Grid container spacing={2} p={4}>
      <Grid xs={12} pb={2}>
        <Typography level="h2">Installed Plugins</Typography>
      </Grid>
      {query.data?.map((plugin) => (
        <Grid xs={12} md={6} xl={4} >
          <InstalledPluginCard key={plugin.id} {...plugin} />
        </Grid>
      ))}
    </Grid>
  )

}

export default InstalledPlugins