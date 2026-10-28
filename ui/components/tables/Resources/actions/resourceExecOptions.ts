import { SessionOptions } from '@omniviewdev/runtime/models';
import type { Value } from '@omniviewdev/runtime';

/** Keep the canonical body at the Wails boundary; presentation data contains bigint. */
export function resourceExecOptions(
  plugin: string,
  resource: string,
  body: Value,
  params: Record<string, string>,
  command: string[],
): SessionOptions {
  return SessionOptions.createFrom({
    params,
    resource_plugin: plugin,
    resource_key: resource,
    resource_data: body,
    command,
    tty: true,
  });
}
