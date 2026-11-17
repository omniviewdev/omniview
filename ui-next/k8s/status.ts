import type { PodObject } from './pod';

/** The seven roles a state is drawn with (ch13 SR1). The role fixes the glyph and the tone; the word keeps its spelling. */
export type StateRole = 'healthy' | 'running' | 'progress' | 'attention' | 'error' | 'stopped' | 'info';

// The platform's own words, one role each: the words of a Pod in the mock's table (MOCK k8s-resource-definitions.js:163-171, K61.3).
// A word that is not here has no role and is drawn as plain text: it is never guessed from its spelling (SR1).
const WORDS: Readonly<Record<StateRole, readonly string[]>> = {
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

const ROLE_OF = new Map<string, StateRole>(Object.entries(WORDS).flatMap(([role, words]) => words.map((word): [string, StateRole] => [word, role as StateRole])));

/** The role of a status word, or undefined when the table has none. `Init:` words take the role of what follows, and an unknown init failure is an error. */
export function stateRole(word: string | undefined): StateRole | undefined {
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
 * by Terminating. A port of `printPod` of the API server (k8s.io/kubernetes pkg/printers/internalversion/printers.go, v1.35.0), which
 * prints the cells `kubectl get pods` shows; the goldens in golden.test.ts are its output. The server version is what decides, so an
 * older cluster can print a word less (a native sidecar, the error of a finished container) than this does.
 */
export function podStatusWord(pod: PodObject): string | undefined {
  const status = pod.status;
  let reason = status?.phase ?? '';
  if (status?.reason !== undefined && status.reason !== '') {
    reason = status.reason;
  }

  if (status?.conditions?.some((condition) => condition.type === 'PodScheduled' && condition.reason === 'SchedulingGated')) {
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

  const initialized = status?.conditions?.find((condition) => condition.type === 'Initialized')?.status === 'True';
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
      const podReady = status?.conditions?.some((condition) => condition.type === 'Ready' && condition.status === 'True') === true;
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
