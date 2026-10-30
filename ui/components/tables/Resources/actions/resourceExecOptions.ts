import { SessionOptions } from '@omniviewdev/runtime/models';
import type { Value, ResourceReference, AccessRoute } from '@omniviewdev/runtime';

/** Keep the canonical body at the Wails boundary; presentation data contains bigint. */
export function resourceExecOptions(
  body: Value,
  params: Record<string, string>,
  command: string[],
  reference: ResourceReference,
  route: AccessRoute,
): SessionOptions {
  return SessionOptions.createFrom({
    params,
    resource_plugin: reference.address.provider,
    resource_key: reference.address.type,
    resource_data: body,
    reference,
    route,
    command,
    tty: true,
  });
}
