/**
 * Back-compat view of the plugin-sdk `resource` package for plugins built
 * against the Wails v2 bindings. See ./legacyEnum.
 */
import { WatchState as Generated } from '../bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/resource/models';
import { withLegacyNames } from './legacyEnum';

export * from '../bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/resource/models';

export const WatchState = withLegacyNames(Generated, 'WatchState');
export type WatchState = Generated;
