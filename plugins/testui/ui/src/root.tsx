import React from 'react'
import { Stack } from '@omniviewdev/ui/layout'
import { Text } from '@omniviewdev/ui/typography'
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
      <Text>Extension Point 1</Text>
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
      <Text>Extension Point 2</Text>
      {components.map((Component, index) => (
        <Stack key={index}>
          {Component.render()}
        </Stack>
      ))}
    </Stack>
  )

}

export default RootPage
