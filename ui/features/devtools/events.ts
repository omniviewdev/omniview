import { eventbus } from '@/events/eventbus';
import type { DevServerState, DevBuildLine, DevBuildError } from './types';

type DevToolsEvents = {
  /** Fired when any dev server's status changes. */
  onStatusChange: (state: DevServerState) => void;

  /** Fired when a build output line is received. */
  onBuildLog: (line: DevBuildLine) => void;

  /** Fired when structured build errors are reported. */
  onBuildError: (payload: { pluginId: string; errors: DevBuildError[] }) => void;

  /** Fired when user requests to open the build output for a plugin. */
  onOpenBuildOutput: (pluginId: string) => void;

  /** Fired when user requests to restart a dev server. */
  onRestartDevServer: (pluginId: string) => void;
};

export const devToolsChannel = eventbus<DevToolsEvents>();
