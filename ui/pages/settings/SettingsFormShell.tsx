import { useContext, type ReactNode } from 'react';
import { Button } from '@omniviewdev/base-ui';
import type { SettingsForm } from '@/hooks/settings/useSettingsForm';
import styles from './SettingsPage.module.css';
import { SettingsCloseContext } from './settingsContext';

type Props = {
  form: SettingsForm;
  pendingRestart: boolean;
  restartTarget: string;
  children: ReactNode;
};

export default function SettingsFormShell({ form, pendingRestart, restartTarget, children }: Props) {
  const close = useContext(SettingsCloseContext);
  return <>
    {form.warning && <p role='alert'>{form.warning}</p>}
    {pendingRestart && <p role='status'>Changes apply after restarting {restartTarget}. Restart {restartTarget} manually to apply saved changes.</p>}
    <fieldset className={styles.Form} disabled={form.saving}>{children}</fieldset>
    <div className={styles.ActionBar}>
      <span role='status'>{form.hasDrafts ? 'Unsaved changes' : 'All changes saved'}</span>
      <div className={styles.Actions}>
        {form.hasDrafts ? <>
          <Button color='neutral' variant='ghost' onClick={form.discard} disabled={form.saving}>Discard</Button>
          <Button color='brand' variant='soft' onClick={form.save} disabled={form.saving} aria-label='Save Changes' aria-busy={form.saving}>
            {form.saving ? 'Checking and saving…' : 'Save Changes'}
          </Button>
        </> : close && <Button color='neutral' variant='soft' onClick={close}>Done</Button>}
      </div>
    </div>
  </>;
}
