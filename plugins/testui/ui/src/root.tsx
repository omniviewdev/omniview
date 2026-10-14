import React from 'react'
import { Stack, Text } from '@omniviewdev/base-ui'
import { useExtensionPointComponents } from '@omniviewdev/runtime';

/**
 * Example root page of the plugin
 */
const RootPage = () => {
  return (
    <Stack
      direction={'row'}
      justify={'around'}
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
