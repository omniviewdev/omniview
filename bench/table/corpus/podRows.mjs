// Pod rows from a `kubectl get pods -A -o json` PodList, in the shape the data layer produces:
//   { key, name, namespace, nameTail, ready: {ready,total}|undefined, status: {word, role}|undefined,
//     restarts: number|undefined, createdAt: epoch ms|undefined, node, ip }
//
// Every derivation is a plain-JS copy of the data layer, not a second opinion. The data layer was `ui-next/k8s/` of this repository; N19c moved it into the Kubernetes
// plugin (repository omniviewdev/omniview-plugin-kubernetes, branch feature/ui-next, `ui/src/pods/data/`; this repository's last copy is commit 19720e3a):
//   row.ts     the row shape and which field comes from where (`podRow`)
//   pod.ts     the typed reading of an object of unknown shape (`toPod`)
//   fields.ts  Ready, Restarts, creation time, node, IP, name tail
//   status.ts  the role table (`stateRole`) and kubectl's STATUS logic (`podStatusWord`)
// at commit dbe3587b (branch ui-next/1a2-data-layer, "the Pod row model", PR 1a.2). When the data layer changes, copy the change here
// and run podRows.test.mjs against a fresh corpus: the oracle is `kubectl get pods`, not this file.

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value) => (typeof value === 'string' ? value : undefined);
const count = (value) => (typeof value === 'number' ? value : undefined);
const flag = (value) => (typeof value === 'boolean' ? value : undefined);
const objects = (value) => (Array.isArray(value) ? value.filter(isObject) : undefined);

// ---- pod.ts: only the part of a Pod the list reads, each field kept only when it has the type the API gives it ----

function condition(source) {
  return { type: text(source.type), status: text(source.status), reason: text(source.reason) };
}

function state(value) {
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

function containerStatus(source) {
  return { name: text(source.name), ready: flag(source.ready), started: flag(source.started), restartCount: count(source.restartCount), state: state(source.state) };
}

/** @param {unknown} value A Pod object as the API serves it. */
export function toPod(value) {
  if (!isObject(value)) {
    return {};
  }

  const { metadata, spec, status } = value;
  return {
    metadata: isObject(metadata)
      ? { name: text(metadata.name), namespace: text(metadata.namespace), uid: text(metadata.uid), creationTimestamp: text(metadata.creationTimestamp), deletionTimestamp: text(metadata.deletionTimestamp) }
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

// ---- fields.ts ----

/** Regular containers that report ready, over the containers the spec declares. Undefined when the spec has no containers list. */
export function podReady(pod) {
  const containers = pod.spec?.containers;
  if (containers === undefined) {
    return undefined;
  }

  return { ready: (pod.status?.containerStatuses ?? []).filter((status) => status.ready === true).length, total: containers.length };
}

/** The sum of the restarts of the regular containers. Undefined when no status was reported, or any count is missing. */
export function podRestarts(pod) {
  const statuses = pod.status?.containerStatuses;
  if (statuses === undefined || statuses.some((status) => status.restartCount === undefined)) {
    return undefined;
  }

  return statuses.reduce((sum, status) => sum + (status.restartCount ?? 0), 0);
}

/** `metadata.creationTimestamp` as epoch milliseconds. */
export function podCreatedAt(pod) {
  const created = pod.metadata?.creationTimestamp;
  const time = created === undefined ? Number.NaN : Date.parse(created);
  return Number.isNaN(time) ? undefined : time;
}

export function podNode(pod) {
  const node = pod.spec?.nodeName;
  return node === undefined || node === '' ? undefined : node;
}

/** `status.podIP`, else the first of `status.podIPs`, which is the one kubectl prints. */
export function podIP(pod) {
  const address = pod.status?.podIP ?? pod.status?.podIPs?.[0]?.ip;
  return address === undefined || address === '' ? undefined : address;
}

/** How many trailing characters ("-7x5nx") a cell keeps whole when it has to cut a generated name; 0 when the name has no such tail. */
export function nameTail(name) {
  return /-[a-z0-9]{1,10}$/.exec(name)?.[0].length ?? 0;
}

// ---- status.ts ----

// The platform's own words, one role each. A word that is not here has no role and is never guessed from its spelling.
const WORDS = {
  healthy: ['Succeeded', 'Completed'],
  running: ['Running'],
  progress: ['Pending', 'ContainerCreating', 'PodInitializing', 'Terminating'],
  attention: ['Unknown'],
  error: [
    'CrashLoopBackOff', 'Error', 'Failed', 'ImagePullBackOff', 'ErrImagePull', 'ErrImageNeverPull', 'OOMKilled', 'Evicted', 'NotReady',
    'CreateContainerConfigError', 'CreateContainerError', 'RunContainerError', 'InvalidImageName', 'ContainerCannotRun', 'DeadlineExceeded',
  ],
  stopped: ['Terminated'],
  info: [],
};

const ROLE_OF = new Map(Object.entries(WORDS).flatMap(([role, words]) => words.map((word) => [word, role])));

/** The role of a status word, or undefined when the table has none. `Init:` words take the role of what follows, and an unknown init failure is an error. */
export function stateRole(word) {
  if (word === undefined) {
    return undefined;
  }

  const known = ROLE_OF.get(word);
  if (known !== undefined) {
    return known;
  }

  if (/^Init:\d+\/\d+$/.test(word)) {
    return 'progress';
  }

  if (word.startsWith('Init:')) {
    return stateRole(word.slice('Init:'.length)) ?? 'error';
  }

  return /^(?:Signal|ExitCode):/.test(word) ? 'error' : undefined;
}

/**
 * kubectl's STATUS column: the phase, replaced by the init container progress, then by the reason a container waits or stopped, then
 * by Terminating. A port of `printPod` of the API server (k8s.io/kubernetes pkg/printers/internalversion/printers.go, v1.35.0).
 */
export function podStatusWord(pod) {
  const status = pod.status;
  let reason = status?.phase ?? '';
  if (status?.reason !== undefined && status.reason !== '') {
    reason = status.reason;
  }

  if (status?.conditions?.some((c) => c.type === 'PodScheduled' && c.reason === 'SchedulingGated')) {
    reason = 'SchedulingGated';
  }

  const initContainers = pod.spec?.initContainers ?? [];
  const restartable = new Set(initContainers.filter((container) => container.restartPolicy === 'Always').map((container) => container.name));
  const initStatuses = status?.initContainerStatuses ?? [];
  let initializing = false;
  for (const [index, container] of initStatuses.entries()) {
    const { terminated, waiting } = container.state ?? {};
    if (terminated !== undefined && (terminated.exitCode ?? 0) === 0) {
      continue;
    }

    if (container.name !== undefined && restartable.has(container.name) && container.started === true) {
      continue;
    }

    initializing = true;
    if (terminated !== undefined) {
      if (terminated.reason !== undefined && terminated.reason !== '') {
        reason = `Init:${terminated.reason}`;
      } else if ((terminated.signal ?? 0) !== 0) {
        reason = `Init:Signal:${terminated.signal}`;
      } else {
        reason = `Init:ExitCode:${terminated.exitCode ?? 0}`;
      }
    } else if (waiting?.reason !== undefined && waiting.reason !== '' && waiting.reason !== 'PodInitializing') {
      reason = `Init:${waiting.reason}`;
    } else {
      reason = `Init:${index}/${initContainers.length}`;
    }

    break;
  }

  const initialized = status?.conditions?.find((c) => c.type === 'Initialized')?.status === 'True';
  if (!initializing || initialized) {
    let hasRunning = false;
    let errorReason = '';
    // kubectl reads the containers from the last to the first, so the first container has the last word.
    for (const container of [...(status?.containerStatuses ?? [])].reverse()) {
      const { terminated, waiting } = container.state ?? {};
      if (waiting?.reason !== undefined && waiting.reason !== '') {
        reason = waiting.reason;
      } else if (terminated !== undefined) {
        if (terminated.reason !== undefined && terminated.reason !== '') {
          reason = terminated.reason;
        } else if ((terminated.signal ?? 0) !== 0) {
          reason = `Signal:${terminated.signal}`;
        } else {
          reason = `ExitCode:${terminated.exitCode ?? 0}`;
        }

        if ((terminated.exitCode ?? 0) !== 0) {
          errorReason = reason;
        }
      } else if (container.ready === true && container.state?.running !== undefined) {
        hasRunning = true;
      }
    }

    // A finished container hides the Pod's state while another still runs, or while another one failed.
    if (reason === 'Completed') {
      const podReady = status?.conditions?.some((c) => c.type === 'Ready' && c.status === 'True') === true;
      if (hasRunning && podReady) {
        reason = 'Running';
      } else if (errorReason !== '') {
        reason = errorReason;
      } else if (hasRunning) {
        reason = 'NotReady';
      }
    }
  }

  const deleting = pod.metadata?.deletionTimestamp !== undefined;
  if (deleting && status?.reason === 'NodeLost') {
    reason = 'Unknown';
  } else if (deleting && status?.phase !== 'Succeeded' && status?.phase !== 'Failed') {
    reason = 'Terminating';
  }

  return reason === '' ? undefined : reason;
}

// ---- row.ts ----

/** One row of one Pod object. `key` is the Pod's uid, the identity the host gives a record. */
export function podRow(object) {
  const pod = toPod(object);
  const word = podStatusWord(pod);
  const name = pod.metadata?.name ?? '';
  return {
    key: pod.metadata?.uid ?? '',
    name,
    namespace: pod.metadata?.namespace ?? '',
    nameTail: nameTail(name),
    ready: podReady(pod),
    status: word === undefined ? undefined : { word, role: stateRole(word) },
    restarts: podRestarts(pod),
    createdAt: podCreatedAt(pod),
    node: podNode(pod),
    ip: podIP(pod),
  };
}

/**
 * The rows of a PodList, in the order of its items.
 * @param {{ items?: unknown[] }} list The parsed output of `kubectl get pods -A -o json`.
 */
export function podRowsFromList(list) {
  if (!isObject(list) || !Array.isArray(list.items)) {
    throw new Error('podRowsFromList: expected a PodList with an items array');
  }

  return list.items.map(podRow);
}
