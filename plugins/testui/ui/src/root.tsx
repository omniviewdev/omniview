import React from 'react'
// import Stack from '@mui/joy/Stack'
// import Typography from '@mui/joy/Typography'
import {
  Stack,
  Typography,
} from '@mui/joy'
import { useExtensionPointComponents } from '@omniviewdev/runtime';

/**
 * Example root page of the plugin
 */
const RootPage = () => {
  return (
    <Stack
      direction={'row'}
      justifyContent={'space-around'}
    >
      <ExtensionPoint1Container />
      <ExtensionPoint2Container />
    </Stack>
  )
}

const ExtensionPoint1Container = () => {
  const components = useExtensionPointComponents('testui/extension1')

  return (
    <Stack>
      <Typography>Extension Point 1</Typography>
      {components.map((Component, index) => (
        <Stack key={index}>
          {Component.render()}
        </Stack>
      ))}
    </Stack>
  )

}

const ExtensionPoint2Container = () => {
  const components = useExtensionPointComponents('testui/extension2')
  return (
    <Stack>
      <Typography>Extension Point 2</Typography>
      {components.map((Component, index) => (
        <Stack key={index}>
          {Component.render()}
        </Stack>
      ))}
    </Stack>
  )

}

export default RootPage
