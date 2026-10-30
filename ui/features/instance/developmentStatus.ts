import { useEffect, useState } from 'react';
import type { InstanceInfo } from './InstanceContext';

export type DevelopmentStatus = {
  workspaceID: string;
  generation: string;
  phase: string;
  failedStage?: string;
  recoveryCommand?: string;
  health: Record<string, string>;
  builds: Record<string, { phase: string }>;
  selectedPluginCount: number | null;
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseDevelopmentStatus(value: unknown, workspaceID: string, generation: string): DevelopmentStatus | null {
  if (!record(value) || !workspaceID || !generation || value.workspaceID !== workspaceID
    || value.generation !== generation || typeof value.phase !== 'string') {
    return null;
  }

  const health: Record<string, string> = {};
  const builds: Record<string, { phase: string }> = {};
  if (record(value.health)) {
    for (const [key, item] of Object.entries(value.health)) {
      if (typeof item === 'string' && item) {
        health[key] = item;
      }
    }
  }

  if (record(value.builds)) {
    for (const [key, item] of Object.entries(value.builds)) {
      if (record(item) && typeof item.phase === 'string') {
        builds[key] = { phase: item.phase };
      }
    }
  }

  return {
    workspaceID, generation, phase: value.phase, health, builds,
    failedStage: typeof value.failedStage === 'string' ? value.failedStage : undefined,
    recoveryCommand: typeof value.recoveryCommand === 'string' ? value.recoveryCommand : undefined,
    selectedPluginCount: typeof value.selectedPluginCount === 'number' && Number.isSafeInteger(value.selectedPluginCount)
      && value.selectedPluginCount >= 0 ? value.selectedPluginCount : null,
  };
}

export function hostStatus(status: DevelopmentStatus | null, hostReady: boolean) {
  if (!status) {
    return { label: 'Unavailable', tone: 'neutral' } as const;
  }

  const builds = Object.values(status.builds);
  if (Boolean(status.failedStage) || status.phase.includes('error') || status.phase === 'failed'
    || status.health.build === 'failed' || builds.some((build) => ['error', 'invalidated'].includes(build.phase))) {
    return { label: 'Failed', tone: 'danger' } as const;
  }

  if (status.health.build === 'building' || builds.some((build) => build.phase === 'building')
    || ['building', 'linking', 'starting', 'starting-frontend', 'starting-host', 'starting-plugins', 'bootstrapping'].includes(status.phase)) {
    return { label: 'Building', tone: 'warning' } as const;
  }

  if (status.health.servedSource === 'stale' || status.health.dependencies === 'stale') {
    return { label: 'Stale', tone: 'neutral' } as const;
  }

  if (hostReady && status.phase === 'ready' && status.health.build === 'ready'
    && status.health.readiness === 'authenticated' && status.health.servedSource === 'current'
    && status.health.dependencies === 'current') {
    return { label: 'Ready', tone: 'success' } as const;
  }

  return { label: 'Unavailable', tone: 'neutral' } as const;
}

export function useDevelopmentStatus(info: InstanceInfo | null, confirmed: boolean) {
  const [snapshot, setSnapshot] = useState<DevelopmentStatus | null>(null);
  const workspaceID = confirmed ? info?.workspaceID : undefined;
  const generation = confirmed ? info?.generation : undefined;
  const [identity, setIdentity] = useState({ workspaceID, generation });
  if (identity.workspaceID !== workspaceID || identity.generation !== generation) {
    setIdentity({ workspaceID, generation });
    setSnapshot(null);
  }

  useEffect(() => {
    if (!workspaceID || !generation) {
      return;
    }

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      controller = new AbortController();
      deadline = setTimeout(() => {
        controller?.abort(); if (!disposed) {
          setSnapshot(null);
        } 
      }, 5000);
      try {
        const response = await fetch('/__omniview_development_status', { cache: 'no-store', signal: controller.signal });
        const next = response.ok ? parseDevelopmentStatus(await response.json(), workspaceID, generation) : null;
        if (!disposed) {
          setSnapshot(next);
        }
      } catch {
        if (!disposed) {
          setSnapshot(null);
        }
      } finally {
        clearTimeout(deadline);
        if (!disposed) {
          timer = setTimeout(() => {
            void poll(); 
          }, 5000);
        }
      }
    };

    void poll();
    return () => {
      disposed = true; clearTimeout(timer); clearTimeout(deadline); controller?.abort(); 
    };
  }, [workspaceID, generation]);
  return snapshot && snapshot.workspaceID === workspaceID && snapshot.generation === generation ? snapshot : null;
}
