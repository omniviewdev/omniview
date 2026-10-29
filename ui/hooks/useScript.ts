import { useCallback, useSyncExternalStore } from 'react';

export type UseScriptStatus = 'idle' | 'loading' | 'ready' | 'error';

// Cached script statuses
const cachedScriptStatuses: Record<string, UseScriptStatus | undefined> = {};

/**
 * Simplified version of https://usehooks-ts.com/react-hook/use-script
 */
function getScriptNode(src: string) {
  const node: HTMLScriptElement | undefined = document.querySelector(
    `script[src="${src}"]`,
  ) as HTMLScriptElement | undefined;
  const status = node?.getAttribute('data-status') as
    | UseScriptStatus
    | undefined;

  return {
    node,
    status,
  };
}

const getServerSnapshot = (): UseScriptStatus => 'loading';

function useScript(src: string): UseScriptStatus {
  const getSnapshot = useCallback((): UseScriptStatus => {
    return cachedScriptStatuses[src] ?? getScriptNode(src).status ?? 'loading';
  }, [src]);

  const subscribe = useCallback((notify: () => void) => {
    const cachedScriptStatus = cachedScriptStatuses[src];
    if (cachedScriptStatus === 'ready' || cachedScriptStatus === 'error') {
      return () => {
        // Settled scripts do not install listeners.
      };
    }

    // Fetch existing script element by src
    // It may have been added by another instance of this hook
    const script = getScriptNode(src);
    let scriptNode = script.node;

    if (!scriptNode) {
      // Create script element and add it to document body
      scriptNode = document.createElement('script');
      scriptNode.src = src;
      scriptNode.async = true;
      scriptNode.setAttribute('data-status', 'loading');
      document.body.appendChild(scriptNode);

      // Store status in attribute on script
      // This can be read by other instances of this hook
      const setAttributeFromEvent = (event: Event) => {
        const scriptStatus: UseScriptStatus
          = event.type === 'load' ? 'ready' : 'error';

        scriptNode?.setAttribute('data-status', scriptStatus);
      };

      scriptNode.addEventListener('load', setAttributeFromEvent);
      scriptNode.addEventListener('error', setAttributeFromEvent);
    }

    // Script event handler to update status in state
    // Note: Even if the script already exists we still need to add
    // event handlers to update the state for *this* hook instance.
    const setStateFromEvent = (event: Event) => {
      const newStatus = event.type === 'load' ? 'ready' : 'error';
      cachedScriptStatuses[src] = newStatus;
      notify();
    };

    // Add event listeners
    scriptNode.addEventListener('load', setStateFromEvent);
    scriptNode.addEventListener('error', setStateFromEvent);

    // Remove event listeners on cleanup

    return () => {
      if (scriptNode) {
        scriptNode.removeEventListener('load', setStateFromEvent);
        scriptNode.removeEventListener('error', setStateFromEvent);
      }

      if (scriptNode) {
        try {
          scriptNode.remove();
        } catch (error) {
          // ignore error
        }
      }
    };
  }, [src]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export default useScript;
