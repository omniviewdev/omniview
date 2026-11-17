import type { PodObject } from './pod';

// What each column of the Pods list says, derived from the object a cluster served (docs/ui-next/slices/1a-pods-list.md 1.3).
// A value the object does not hold is undefined: the cell draws a dash with its reason, never 0, an empty string or a word (ch13 D7).

export type PodReady = {
  readonly ready: number;
  readonly total: number;
};

/** Regular containers that report ready, over the containers the spec declares. Undefined when the spec has no containers list. */
export function podReady(pod: PodObject): PodReady | undefined {
  const containers = pod.spec?.containers;
  if (containers === undefined) {
    return undefined;
  }

  return { ready: (pod.status?.containerStatuses ?? []).filter((status) => status.ready === true).length, total: containers.length };
}

/** The sum of the restarts of the regular containers. Undefined when no status was reported, or any count is missing (plan E4). */
export function podRestarts(pod: PodObject): number | undefined {
  const statuses = pod.status?.containerStatuses;
  if (statuses === undefined || statuses.some((status) => status.restartCount === undefined)) {
    return undefined;
  }

  return statuses.reduce((sum, status) => sum + (status.restartCount ?? 0), 0);
}

/** `metadata.creationTimestamp` as epoch milliseconds. */
export function podCreatedAt(pod: PodObject): number | undefined {
  const created = pod.metadata?.creationTimestamp;
  const time = created === undefined ? Number.NaN : Date.parse(created);
  return Number.isNaN(time) ? undefined : time;
}

export function podNode(pod: PodObject): string | undefined {
  const node = pod.spec?.nodeName;
  return node === undefined || node === '' ? undefined : node;
}

/** `status.podIP`, else the first of `status.podIPs`, which is the one kubectl prints. */
export function podIP(pod: PodObject): string | undefined {
  const address = pod.status?.podIP ?? pod.status?.podIPs?.[0]?.ip;
  return address === undefined || address === '' ? undefined : address;
}

/** How many trailing characters ("-7x5nx") a cell keeps whole when it has to cut a generated name; 0 when the name has no such tail. */
export function nameTail(name: string): number {
  return /-[a-z0-9]{1,10}$/.exec(name)?.[0].length ?? 0;
}

export type PodAge = {
  /** One unit, rounded down: `42s`, `5m`, `3h`, `17d`; `in 5m` when the cluster's clock is ahead. */
  readonly text: string;
  /** The absolute time and the words, for the tip: `2026-11-01 09:00 UTC · 3 days ago`. */
  readonly long: string;
};

const counted = (value: number, word: string) => `${value} ${word}${value === 1 ? '' : 's'}`;

function compactAge(seconds: number): string {
  if (seconds >= 86400) {
    return `${Math.floor(seconds / 86400)}d`;
  }

  if (seconds >= 3600) {
    return `${Math.floor(seconds / 3600)}h`;
  }

  if (seconds >= 60) {
    return `${Math.floor(seconds / 60)}m`;
  }

  return `${Math.max(0, Math.floor(seconds))}s`;
}

function words(seconds: number): string {
  if (seconds < 3600) {
    return counted(Math.max(1, Math.floor(seconds / 60)), 'minute');
  }

  if (seconds < 86400) {
    return counted(Math.floor(seconds / 3600), 'hour');
  }

  if (seconds < 86400 * 60) {
    return counted(Math.floor(seconds / 86400), 'day');
  }

  if (seconds < 86400 * 730) {
    return counted(Math.floor(seconds / 86400 / 30), 'month');
  }

  return counted(Math.floor(seconds / 86400 / 365), 'year');
}

/** The age of a Pod as the mock draws it (MOCK k8s-resource-definitions.js `Cell.age`): one unit in the cell, the exact time in the tip. */
export function formatAge(createdAt: number, now: number): PodAge {
  const delta = (now - createdAt) / 1000;
  const seconds = Math.abs(delta);
  const stamp = `${new Date(createdAt).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  if (delta < 0) {
    return { text: `in ${compactAge(seconds)}`, long: `${stamp} · ${seconds < 60 ? 'now' : `in ${words(seconds)}`}` };
  }

  return { text: compactAge(seconds), long: `${stamp} · ${seconds < 60 ? 'just now' : `${words(seconds)} ago`}` };
}
