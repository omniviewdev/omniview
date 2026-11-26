import { Button } from '@omniviewdev/base-ui';
import { openSettings } from '@omniviewdev/runtime';
import { RestartToUpdateButton } from './RestartToUpdateButton';
import { updateSettingsTarget } from './types';
import { useUpdateStatus } from './useUpdateStatus';

const openUpdateSettings = () => {
  void openSettings(updateSettingsTarget);
};

/** Header control for a prepared or available update. Background errors stay on the Updates page. */
export function UpdateIndicator() {
  const { status } = useUpdateStatus();
  if (status?.state === 'ready') {
    return <RestartToUpdateButton status={status} onError={openUpdateSettings} />;
  }

  if (status?.state === 'available') {
    return <Button onClick={openUpdateSettings}>Update {status.availableVersion} available</Button>;
  }

  return null;
}
