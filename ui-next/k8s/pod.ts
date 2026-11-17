import { valueToJSON, type HostRecord } from '@omniviewdev/runtime/ui/v1';

// The part of a Pod that the list reads. A record body is an exact `Value` tree, not a Kubernetes object: `valueToJSON` is the
// presentation projection (integers become numbers, timestamps stay strings). Anything the object does not hold is absent here, and
// stays absent downstream: nothing in this layer turns a missing field into 0, an empty string or a word.

export type PodCondition = {
  readonly type?: string;
  readonly status?: string;
  readonly reason?: string;
};

export type ContainerState = {
  readonly running?: Record<string, unknown>;
  readonly waiting?: { readonly reason?: string };
  readonly terminated?: { readonly exitCode?: number; readonly signal?: number; readonly reason?: string };
};

export type ContainerStatus = {
  readonly name?: string;
  readonly ready?: boolean;
  readonly started?: boolean;
  readonly restartCount?: number;
  readonly state?: ContainerState;
};

export type PodObject = {
  readonly metadata?: {
    readonly name?: string;
    readonly namespace?: string;
    readonly creationTimestamp?: string;
    readonly deletionTimestamp?: string;
  };
  readonly spec?: {
    readonly nodeName?: string;
    readonly containers?: ReadonlyArray<{ readonly name?: string }>;
    readonly initContainers?: ReadonlyArray<{ readonly name?: string; readonly restartPolicy?: string }>;
  };
  readonly status?: {
    readonly phase?: string;
    readonly reason?: string;
    readonly podIP?: string;
    readonly podIPs?: ReadonlyArray<{ readonly ip?: string }>;
    readonly conditions?: readonly PodCondition[];
    readonly containerStatuses?: readonly ContainerStatus[];
    readonly initContainerStatuses?: readonly ContainerStatus[];
  };
};

type Json = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const count = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);
const flag = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined);
const objects = (value: unknown): readonly Json[] | undefined => (Array.isArray(value) ? value.filter(isObject) : undefined);

function condition(source: Json): PodCondition {
  return { type: text(source.type), status: text(source.status), reason: text(source.reason) };
}

function state(value: unknown): ContainerState | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  const { running, waiting, terminated } = value;
  return {
    ...(isObject(running) ? { running } : {}),
    ...(isObject(waiting) ? { waiting: { reason: text(waiting.reason) } } : {}),
    ...(isObject(terminated) ? { terminated: { exitCode: count(terminated.exitCode), signal: count(terminated.signal), reason: text(terminated.reason) } } : {}),
  };
}

function containerStatus(source: Json): ContainerStatus {
  return { name: text(source.name), ready: flag(source.ready), started: flag(source.started), restartCount: count(source.restartCount), state: state(source.state) };
}

/** What the list reads of an object of unknown shape: each field kept only when it has the type the API gives it. */
function toPod(value: unknown): PodObject {
  if (!isObject(value)) {
    return {};
  }

  const { metadata, spec, status } = value;
  return {
    metadata: isObject(metadata)
      ? { name: text(metadata.name), namespace: text(metadata.namespace), creationTimestamp: text(metadata.creationTimestamp), deletionTimestamp: text(metadata.deletionTimestamp) }
      : undefined,
    spec: isObject(spec)
      ? {
        nodeName: text(spec.nodeName),
        containers: objects(spec.containers)?.map((container) => ({ name: text(container.name) })),
        initContainers: objects(spec.initContainers)?.map((container) => ({ name: text(container.name), restartPolicy: text(container.restartPolicy) })),
      }
      : undefined,
    status: isObject(status)
      ? {
        phase: text(status.phase),
        reason: text(status.reason),
        podIP: text(status.podIP),
        podIPs: objects(status.podIPs)?.map((address) => ({ ip: text(address.ip) })),
        conditions: objects(status.conditions)?.map(condition),
        containerStatuses: objects(status.containerStatuses)?.map(containerStatus),
        initContainerStatuses: objects(status.initContainerStatuses)?.map(containerStatus),
      }
      : undefined,
  };
}

/** The Pod a record holds. A body that is not a Pod gives an empty one, never an error: one odd object must not take the list down. */
export function podObject(host: HostRecord): PodObject {
  return toPod(valueToJSON(host.record.body));
}
