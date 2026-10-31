import React from 'react';
import { Button, Dialog, Text } from '@omniviewdev/base-ui';
import { Events } from '@wailsio/runtime';
import { McpRelayClient } from '@omniviewdev/runtime/api';
import type { mcprelay } from '@omniviewdev/runtime/models';

type PendingConfirmation = mcprelay.PendingConfirmation;

const formatArguments = (raw: unknown) => {
  if (raw === null || raw === undefined) {
    return '{}';
  }

  if (typeof raw === 'string') {
    try {
      // Preserve exact integer and decimal tokens supplied by the host.
      JSON.parse(raw);
      return raw;
    } catch {
      return raw;
    }
  }

  return JSON.stringify(raw, null, 2);
};

/**
 * Shows one dialog per pending MCP tool call that the policy marks "confirm".
 * The backend emits `mcp/confirmation/requested` and `.../resolved`; the
 * list is also loaded on mount so a reload does not lose open requests.
 */
export const McpConfirmationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [pending, setPending] = React.useState<PendingConfirmation[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [loadError, setLoadError] = React.useState(false);
  const [decisionError, setDecisionError] = React.useState<string | null>(null);
  const [reload, setReload] = React.useState(0);
  const resolved = React.useRef(new Set<string>());

  React.useEffect(() => {
    let cancelled = false;
    const requested = new Map<string, PendingConfirmation>();
    const offRequested = Events.On('mcp/confirmation/requested', (event) => {
      const item = event.data;
      if (resolved.current.has(item.id)) {
        return;
      }

      requested.set(item.id, item);
      setPending((current) => (current.some((p) => p.id === item.id) ? current : [...current, item]));
    });
    const offResolved = Events.On('mcp/confirmation/resolved', (event) => {
      resolved.current.add(event.data.id);
      requested.delete(event.data.id);
      setPending((current) => current.filter((p) => p.id !== event.data.id));
    });
    void McpRelayClient.ListPendingConfirmations().then(
      (items) => {
        if (cancelled) {
          return;
        }

        const merged = new Map(items.map((item) => [item.id, item]));
        requested.forEach((item, id) => merged.set(id, item));
        setPending([...merged.values()].filter((item) => !resolved.current.has(item.id)));
        setLoadError(false);
      },
      () => {
        if (!cancelled) {
          setLoadError(true);
        }
      },
    );
    return () => {
      cancelled = true;
      offRequested();
      offResolved();
    };
  }, [reload]);

  const current = pending[0];

  const reloadPending = () => {
    setLoadError(false);
    setReload((value) => value + 1);
  };

  const resolve = async (approved: boolean) => {
    if (!current) {
      return;
    }

    setBusy(true);
    setDecisionError(null);
    try {
      await McpRelayClient.ResolveConfirmation(current.id, approved);
      resolved.current.add(current.id);
      setPending((items) => items.filter((p) => p.id !== current.id));
    } catch {
      setDecisionError(current.id);
    } finally {
      setBusy(false);
    }
  };

  const deny = async () => resolve(false);
  const allow = async () => resolve(true);

  return (
    <>
      {children}
      {loadError && (
        <div role='alert'>
          Pending tool requests could not be loaded.
          <Button onClick={reloadPending}>Retry pending requests</Button>
        </div>
      )}
      {current && (
        <Dialog open onClose={() => undefined} size='md'>
          <Dialog.Title>{`Allow ${current.pluginName} tool "${current.mcpName}"?`}</Dialog.Title>
          <Dialog.Body>
            <Text size='sm'>External agent using this host's shared MCP bearer credential.</Text>
            <Text size='xs'>The credential authenticates access, not a distinct person or client name. Approval applies only to this request.</Text>
            <Text size='sm'>Plugin: {current.pluginName} ({current.pluginID}); tool: {current.mcpName}</Text>
            <Text size='xs'>Host origin: {current.origin}; credential: {current.credentialID}; request session: {current.sessionID}</Text>
            <Text size='xs'>Exact target</Text>
            <pre data-testid='mcp-confirmation-target'>{formatArguments(current.target)}</pre>
            {decisionError === current.id && (
              <div role='alert'>
                Decision could not be submitted. Retry Allow or Deny.
                <Button disabled={busy} onClick={reloadPending}>Reload pending requests</Button>
              </div>
            )}
            {current.connectionID && (
              <Text size='sm'>
                Connection: {current.connectionName || current.connectionID} ({current.connectionID})
              </Text>
            )}
            <Text size='xs'>Arguments</Text>
            <pre data-testid='mcp-confirmation-arguments'>{current.argumentsJSON}</pre>
            {pending.length > 1 && <Text size='xs'>{pending.length - 1} more request(s) waiting</Text>}
          </Dialog.Body>
          <Dialog.Footer>
            <Button variant='ghost' color='neutral' disabled={busy} onClick={deny}>
              Deny
            </Button>
            <Button variant='solid' color='danger' disabled={busy} onClick={allow}>
              Allow
            </Button>
          </Dialog.Footer>
        </Dialog>
      )}
    </>
  );
};

