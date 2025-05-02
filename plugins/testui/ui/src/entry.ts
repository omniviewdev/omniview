import { PluginWindow } from '@omniviewdev/runtime';
import { ExtensionPointSettings } from "@omniviewdev/runtime";
import RootPage from './root'

const extensionPoints: ExtensionPointSettings[] = [
  {
    owner: 'testui',
    id: 'testui/extension1',
    name: 'Test Extension 1',
    mode: 'single',
  },
  {
    owner: 'testui',
    id: 'testui/extension2',
    name: 'Test Extension 2',
    mode: 'multiple',
  }
]

export const plugin = new PluginWindow()
  .setRootPage(RootPage)
  .registerExtensionPoints(extensionPoints)
