import React from 'react';
import { Call } from '@wailsio/runtime';
import { Button } from '@omniviewdev/base-ui';
import { useConfirmationModal } from '@omniviewdev/runtime';
import { type ActiveWork, type UpdateStatus, updateServiceName } from './types';

const activeWorkBlocksRestart = 'active work would be lost';

/** Restarts into the prepared update, and asks first when the restart would end active work. */
export function RestartToUpdateButton({ status, onError }: { status: UpdateStatus; onError: (message: string) => void }) {
  const { show } = useConfirmationModal();
  const [busy, setBusy] = React.useState(false);

  const restart = async (restartDespiteActiveWork: boolean) => {
    await Call.ByName(`${updateServiceName}.Restart`, restartDespiteActiveWork);
  };

  const confirm = (work: ActiveWork[]) => {
    show({
      title: 'Restart Omniview?',
      body: <div>
        <p>Restarting ends this work:</p>
        <ul>{work.map((item, index) => <li key={index}>{item.description}</li>)}</ul>
      </div>,
      confirmLabel: 'Restart anyway',
      cancelLabel: 'Cancel',
      onConfirm: async () => {
        // Cancel can close the dialog while the restart is pending; keep the button disabled.
        setBusy(true);
        try {
          await restart(true);
        } catch (err) {
          onError(String(err));
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const onClick = async () => {
    setBusy(true);
    try {
      const work = await Call.ByName(`${updateServiceName}.ActiveWork`) as ActiveWork[];
      if (work.length > 0) {
        confirm(work);
        return;
      }

      try {
        await restart(false);
      } catch (err) {
        if (!String(err).includes(activeWorkBlocksRestart)) {
          throw err;
        }

        // Work started between the listing and the restart.
        confirm(await Call.ByName(`${updateServiceName}.ActiveWork`) as ActiveWork[]);
      }
    } catch (err) {
      onError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const switching = Boolean(status.switchTarget);
  return <Button
    variant={switching ? 'solid' : undefined}
    color={switching ? 'danger' : undefined}
    disabled={busy}
    onClick={() => {
      void onClick();
    }}
  >
    {switching ? `Restart into ${status.switchTarget}` : 'Restart to Update'}
  </Button>;
}
