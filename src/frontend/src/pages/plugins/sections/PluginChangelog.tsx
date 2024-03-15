import React from 'react'

// material-ui
import Stack from '@mui/joy/Stack'

// mock data
import mock from '../mock/kubernetes/changelog.json'
import PluginChangelogCard from './PluginChangelogCard'

type Props = {
  id: string
}

export interface Changelog {
  version: string
  releaseDate: string
  changes: Changes
}

export interface Changes {
  feature: string[]
  bugfix: string[]
  security: string[]
}

const PluginChangelog: React.FC<Props> = ({ }) => {
  return (
    <Stack direction="column" p={6} gap={3} maxHeight={'100%'} overflow={'scroll'}>
      {mock.map((record: Changelog) => (
        <PluginChangelogCard {...record} />
      ))}
    </Stack>
  )
}

export default PluginChangelog
