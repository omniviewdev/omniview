import { Button, KeyValue, SectionCard } from '@omniviewdev/kit';
import { useCallback, useLayoutEffect, useMemo, useReducer, useState, useSyncExternalStore } from 'react';
import type { DetailScope } from './detailScope';
import { EXTENSION_INPUT_CHANGED, type ExtensionBinding, type ExtensionDemand, type ExtensionPlacement } from './extensionAuthority';
import { evaluateExtensionFeature, type ExtensionFeatureResult } from './extensionFeature';
import styles from './DetailOutlets.module.css';

type Result = ExtensionFeatureResult | 'failed';
export type DetailInvocation = { readonly demand: ExtensionDemand; readonly settled: Promise<Result> };

/** Start exactly once, at the demand site, not in a result component's (potentially replayed) effect. */
export function invokeDetailFeature(scope: DetailScope, demand: ExtensionDemand): DetailInvocation {
  return { demand, settled: evaluateExtensionFeature(scope.authority, demand).catch(() => 'failed' as const) };
}

/** The token and not the presence of a React element decides whether even an error may be displayed. */
export function ScalarAnswer({ scope, invocation, label, onRetry }: { readonly scope: DetailScope; readonly invocation: DetailInvocation; readonly label: string; readonly onRetry?: () => void }) {
  const { authority } = scope;
  const { demand, settled } = invocation;
  const [result, setResult] = useState<Result>();
  const [waiting, setWaiting] = useState('');
  const subscribe = useCallback((notify: () => void) => {
    demand.signal.addEventListener('abort', notify);
    return () => {
      demand.signal.removeEventListener('abort', notify);
    };
  }, [demand]);
  const aborted = useSyncExternalStore(subscribe, () => demand.signal.aborted);
  useLayoutEffect(() => {
    let mounted = true;
    const current = () => mounted && scope.current() && authority.current(demand);
    if (!current()) {
      return;
    }

    const announce = setTimeout(() => {
      if (current()) {
        setWaiting('Loading…');
      }
    }, 200);
    const slow = setTimeout(() => {
      if (current()) {
        setWaiting('Still loading…');
      }
    }, 1000);
    void settled.then(result => {
      clearTimeout(announce);
      clearTimeout(slow);
      if (current()) {
        setResult(result);
      }
    });
    return () => {
      mounted = false;
      clearTimeout(announce);
      clearTimeout(slow);
    };
  }, [authority, scope, demand, settled]);
  if (aborted || !scope.current() || !authority.current(demand)) {
    return null;
  }

  return <div className={styles.result}>
    <div role="group" aria-label={label} aria-busy={result === undefined}>
      {result !== undefined && result !== 'failed' && 'value' in result && <KeyValue rows={[{ label: result.label, value: result.value }]} />}
    </div>
    <span role="status" aria-label={label} aria-atomic="true">{result === undefined ? waiting : result === 'failed' ? 'Information unavailable.' : 'text' in result ? result.text : ''}</span>
    {result === 'failed' && onRetry && <Button size="compact" onClick={onRetry}>Retry</Button>}
  </div>;
}

/** React reads the committed demand; creating or retrying a fact never starts code during render. */
function observeFact(scope: DetailScope, placement: ExtensionPlacement, binding: ExtensionBinding) {
  let invocation: DetailInvocation | null | undefined;
  let listener: (() => void) | undefined;
  const publish = (next: typeof invocation) => {
    if (invocation !== next) {
      invocation = next;
      listener?.();
    }
  };

  return {
    snapshot: () => invocation,
    subscribe(notify: () => void) {
      listener = notify;
      return () => {
        listener = undefined;
      };
    },
    start(retry: () => void) {
      if (!scope.current()) {
        return;
      }

      const { authority } = scope;
      const token = authority.beginDemand(placement, binding);
      if (!token) {
        publish(null);
        return;
      }

      const obsolete = () => {
        // A new projection on the same ready object needs a fresh fact. A withdrawn placement must not come back.
        if (token.signal.reason === EXTENSION_INPUT_CHANGED && scope.current() && authority.eligible(placement).includes(binding)) {
          publish(undefined);
          retry();
        } else {
          publish(null);
        }
      };

      token.signal.addEventListener('abort', obsolete, { once: true });
      const next = invokeDetailFeature(scope, token);
      if (!token.signal.aborted) {
        publish(next);
      }

      return () => {
        token.signal.removeEventListener('abort', obsolete);
        authority.endDemand(token);
      };
    },
  };
}

export function DetailFact({ scope, placement, binding, label }: {
  readonly scope: DetailScope; readonly placement: ExtensionPlacement; readonly binding: ExtensionBinding; readonly label: string;
}) {
  const [attempt, retry] = useReducer((n: number) => n + 1, 0);
  const observation = useMemo(() => observeFact(scope, placement, binding), [scope, placement, binding]);
  useLayoutEffect(() => observation.start(retry), [observation, attempt, retry]);
  const invocation = useSyncExternalStore(observation.subscribe, observation.snapshot);
  return <SectionCard title={label} pad>{invocation
    ? <ScalarAnswer key={invocation.demand.generation} scope={scope} invocation={invocation} label={label} onRetry={retry} />
    : invocation === null ? <span role="status" aria-label={label} aria-atomic="true">Information unavailable. <Button size="compact" onClick={retry}>Retry</Button></span>
      : <div className={styles.result} role="group" aria-label={label} aria-busy="true" />}
  </SectionCard>;
}
