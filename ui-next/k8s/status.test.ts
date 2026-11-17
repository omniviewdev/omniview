import { describe, expect, it } from 'vitest';
import type { PodObject } from './pod';
import { podStatusWord, stateRole } from './status';

// kubectl's STATUS column is printed by the API server (`printPod`, k8s.io/kubernetes pkg/printers/internalversion/printers.go, v1.35.0).
// These cases walk that function branch by branch; the real objects it printed on a kind v1.35 cluster are in golden.test.ts.

const running = { name: 'app', ready: true, restartCount: 0, state: { running: { startedAt: '2026-11-16T20:00:00Z' } } };
const pod = (status: NonNullable<PodObject['status']>, spec: PodObject['spec'] = {}, metadata: PodObject['metadata'] = {}): PodObject => ({ metadata, spec, status });

describe('podStatusWord: the phase, replaced step by step as kubectl does', () => {
  it('is the phase, or the reason the status carries', () => {
    expect(podStatusWord(pod({ phase: 'Running', containerStatuses: [running] }))).toBe('Running');
    expect(podStatusWord(pod({ phase: 'Pending' }))).toBe('Pending');
    expect(podStatusWord(pod({ phase: 'Succeeded' }))).toBe('Succeeded');
    expect(podStatusWord(pod({ phase: 'Failed', reason: 'Evicted' }))).toBe('Evicted');
  });

  it('is undefined when the status says nothing', () => {
    expect(podStatusWord({})).toBeUndefined();
    expect(podStatusWord(pod({}))).toBeUndefined();
  });

  it('says SchedulingGated while the PodScheduled condition carries that reason', () => {
    const gated = pod({ phase: 'Pending', conditions: [{ type: 'PodScheduled', status: 'False', reason: 'SchedulingGated' }] });

    expect(podStatusWord(gated)).toBe('SchedulingGated');
  });
});

describe('podStatusWord: init containers', () => {
  const spec = { initContainers: [{ name: 'a' }, { name: 'b' }] };

  it('reports the progress of init containers that are still running', () => {
    const first = pod({ phase: 'Pending', initContainerStatuses: [{ name: 'a', state: { running: {} } }, { name: 'b', state: { waiting: { reason: 'PodInitializing' } } }] }, spec);
    const second = pod({ phase: 'Pending', initContainerStatuses: [{ name: 'a', state: { terminated: { exitCode: 0, reason: 'Completed' } } }, { name: 'b', state: { running: {} } }] }, spec);

    expect(podStatusWord(first)).toBe('Init:0/2');
    expect(podStatusWord(second)).toBe('Init:1/2');
  });

  it('names the reason an init container waits, except PodInitializing', () => {
    const waiting = (reason: string) => pod({ phase: 'Pending', initContainerStatuses: [{ name: 'a', state: { waiting: { reason } } }] }, { initContainers: [{ name: 'a' }] });

    expect(podStatusWord(waiting('ImagePullBackOff'))).toBe('Init:ImagePullBackOff');
    expect(podStatusWord(waiting('PodInitializing'))).toBe('Init:0/1');
  });

  it('names the failure of an init container: its reason, else its signal, else its exit code', () => {
    const failed = (terminated: Record<string, unknown>) => pod({ phase: 'Pending', initContainerStatuses: [{ name: 'a', state: { terminated } }] }, { initContainers: [{ name: 'a' }] });

    expect(podStatusWord(failed({ exitCode: 3, reason: 'Error' }))).toBe('Init:Error');
    expect(podStatusWord(failed({ exitCode: 137, signal: 9 }))).toBe('Init:Signal:9');
    expect(podStatusWord(failed({ exitCode: 3 }))).toBe('Init:ExitCode:3');
  });

  it('moves on to the containers once every init container has finished', () => {
    const done = pod({
      phase: 'Running',
      initContainerStatuses: [{ name: 'a', state: { terminated: { exitCode: 0, reason: 'Completed' } } }],
      containerStatuses: [running],
    }, { initContainers: [{ name: 'a' }] });

    expect(podStatusWord(done)).toBe('Running');
  });

  it('keeps reading the containers when the Initialized condition is true, whatever the init statuses say', () => {
    const initialized = pod({
      phase: 'Running',
      conditions: [{ type: 'Initialized', status: 'True' }],
      initContainerStatuses: [{ name: 'a', state: { waiting: { reason: 'ImagePullBackOff' } } }],
      containerStatuses: [{ name: 'app', state: { waiting: { reason: 'CrashLoopBackOff' } } }],
    }, { initContainers: [{ name: 'a' }] });

    expect(podStatusWord(initialized)).toBe('CrashLoopBackOff');
  });

  it('does not count a started restartable init container (a native sidecar) as initializing', () => {
    const sidecar = pod({
      phase: 'Running',
      initContainerStatuses: [{ name: 'side', started: true, ready: true, state: { running: {} } }],
      containerStatuses: [running],
    }, { initContainers: [{ name: 'side', restartPolicy: 'Always' }] });

    expect(podStatusWord(sidecar)).toBe('Running');
  });
});

describe('podStatusWord: containers', () => {
  it('names the reason a container waits', () => {
    const waiting = (reason: string) => pod({ phase: 'Pending', containerStatuses: [{ name: 'app', state: { waiting: { reason } } }] });

    expect(podStatusWord(waiting('ContainerCreating'))).toBe('ContainerCreating');
    expect(podStatusWord(waiting('ErrImagePull'))).toBe('ErrImagePull');
    expect(podStatusWord(waiting('CrashLoopBackOff'))).toBe('CrashLoopBackOff');
  });

  it('names how a container stopped: its reason, else its signal, else its exit code', () => {
    const stopped = (terminated: Record<string, unknown>) => pod({ phase: 'Failed', containerStatuses: [{ name: 'app', state: { terminated } }] });

    expect(podStatusWord(stopped({ exitCode: 0, reason: 'Completed' }))).toBe('Completed');
    expect(podStatusWord(stopped({ exitCode: 1, reason: 'Error' }))).toBe('Error');
    expect(podStatusWord(stopped({ exitCode: 137, reason: 'OOMKilled' }))).toBe('OOMKilled');
    expect(podStatusWord(stopped({ exitCode: 137, signal: 9 }))).toBe('Signal:9');
    expect(podStatusWord(stopped({ exitCode: 5 }))).toBe('ExitCode:5');
  });

  it('lets the first container win, because kubectl reads them from the last to the first', () => {
    const both = pod({
      phase: 'Running',
      containerStatuses: [
        { name: 'a', state: { waiting: { reason: 'ImagePullBackOff' } } },
        { name: 'b', state: { waiting: { reason: 'CrashLoopBackOff' } } },
      ],
    });

    expect(podStatusWord(both)).toBe('ImagePullBackOff');
  });

  it('turns Completed back into Running when a container still runs and the Pod is Ready', () => {
    const mixed = (conditions: Array<Record<string, unknown>>) => pod({
      phase: 'Running',
      conditions,
      containerStatuses: [{ name: 'quick', state: { terminated: { exitCode: 0, reason: 'Completed' } } }, running],
    });

    expect(podStatusWord(mixed([{ type: 'Ready', status: 'True' }]))).toBe('Running');
    expect(podStatusWord(mixed([{ type: 'Ready', status: 'False' }]))).toBe('NotReady');
  });

  it('keeps the error of a container that failed when another finished well', () => {
    const failedAndDone = pod({
      phase: 'Failed',
      containerStatuses: [
        { name: 'a', state: { terminated: { exitCode: 0, reason: 'Completed' } } },
        { name: 'b', state: { terminated: { exitCode: 1, reason: 'Error' } } },
      ],
    });

    expect(podStatusWord(failedAndDone)).toBe('Error');
  });
});

describe('podStatusWord: deletion', () => {
  const deleted = { deletionTimestamp: '2026-11-16T20:10:00Z' };

  it('says Terminating for a Pod that is being deleted', () => {
    expect(podStatusWord(pod({ phase: 'Running', containerStatuses: [running] }, {}, deleted))).toBe('Terminating');
  });

  it('does not say Terminating once the phase is terminal', () => {
    expect(podStatusWord(pod({ phase: 'Succeeded' }, {}, deleted))).toBe('Succeeded');
    expect(podStatusWord(pod({ phase: 'Failed' }, {}, deleted))).toBe('Failed');
  });

  it('says Unknown for a Pod whose node was lost', () => {
    expect(podStatusWord(pod({ phase: 'Running', reason: 'NodeLost', containerStatuses: [running] }, {}, deleted))).toBe('Unknown');
  });
});

describe('stateRole: the platform words and their one role each (mock K61.3, ch13 SR1)', () => {
  const roles: ReadonlyArray<readonly [string, string]> = [
    ['Running', 'running'],
    ['Completed', 'healthy'],
    ['Succeeded', 'healthy'],
    ['Pending', 'progress'],
    ['ContainerCreating', 'progress'],
    ['PodInitializing', 'progress'],
    ['Terminating', 'progress'],
    ['Unknown', 'attention'],
    ['CrashLoopBackOff', 'error'],
    ['ImagePullBackOff', 'error'],
    ['ErrImagePull', 'error'],
    ['Error', 'error'],
    ['Failed', 'error'],
    ['OOMKilled', 'error'],
    ['Evicted', 'error'],
    ['NotReady', 'error'],
    ['Init:0/2', 'progress'],
    ['Init:1/1', 'progress'],
    ['Init:Error', 'error'],
    ['Init:CrashLoopBackOff', 'error'],
    ['Init:Signal:9', 'error'],
    ['Init:ExitCode:3', 'error'],
    ['Init:SomethingNew', 'error'],
    ['Signal:9', 'error'],
    ['ExitCode:1', 'error'],
  ];

  for (const [word, role] of roles) {
    it(`${word} is ${role}`, () => {
      expect(stateRole(word)).toBe(role);
    });
  }

  it('has no role for a word the table does not hold: it is drawn as plain text, never guessed', () => {
    expect(stateRole('SchedulingGated')).toBeUndefined();
    expect(stateRole('ContainerStatusUnknown')).toBeUndefined();
    expect(stateRole('')).toBeUndefined();
    expect(stateRole(undefined)).toBeUndefined();
  });
});
