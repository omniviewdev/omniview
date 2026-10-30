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
      return JSON.stringify(JSON.parse(raw), null, 2);
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

  React.useEffect(() => {
    let cancelled = false;
    void McpRelayClient.ListPendingConfirmations().then(
      (items) => {
        if (!cancelled) {
          // Merge: an event may have arrived before this list resolved.
          setPending((current) => [...items, ...current.filter((p) => !items.some((i) => i.id === p.id))]);
        }
      },
      () => undefined,
    );
    const offRequested = Events.On('mcp/confirmation/requested', (event) => {
      const item = event.data;
      setPending((current) => (current.some((p) => p.id === item.id) ? current : [...current, item]));
    });
    const offResolved = Events.On('mcp/confirmation/resolved', (event) => {
      const resolved = event.data;
      setPending((current) => current.filter((p) => p.id !== resolved.id));
    });
    return () => {
      cancelled = true;
      offRequested();
      offResolved();
    };
  }, []);

  const current = pending[0];

  const resolve = async (approved: boolean) => {
    if (!current) {
      return;
    }

    setBusy(true);
    try {
      await McpRelayClient.ResolveConfirmation(current.id, approved);
    } finally {
      setBusy(false);
      setPending((items) => items.filter((p) => p.id !== current.id));
    }
  };

  const deny = async () => resolve(false);
  const allow = async () => resolve(true);

  return (
    <>
      {children}
      {current && (
        <Dialog open onClose={() => undefined} size='md'>
          <Dialog.Title>{`Allow ${current.pluginName} tool "${current.mcpName}"?`}</Dialog.Title>
          <Dialog.Body>
            {current.connectionID && (
              <Text size='sm'>
                Connection: {current.connectionName || current.connectionID} ({current.connectionID})
              </Text>
            )}
            <Text size='xs'>Arguments</Text>
            <pre data-testid='mcp-confirmation-arguments'>{formatArguments(current.arguments)}</pre>
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
