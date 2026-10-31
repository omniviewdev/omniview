import type { ReactNode } from 'react';
import { Button } from '@omniviewdev/base-ui';
import type { SettingsForm } from '@/hooks/settings/useSettingsForm';
import styles from './SettingsPage.module.css';

type Props = {
  form: SettingsForm;
  pendingRestart: boolean;
  children: ReactNode;
};

export default function SettingsFormShell({ form, pendingRestart, children }: Props) {
  return <>
    {form.warning && <p role='alert'>{form.warning}</p>}
    {pendingRestart && <p role='status'>Changes apply after restarting Omniview. Restart Omniview manually to apply saved changes.</p>}
    <fieldset className={styles.Form} disabled={form.saving}>{children}</fieldset>
    {form.hasDrafts && <div className={styles.ActionBar}>
      <Button color='brand' variant='soft' onClick={form.save} disabled={form.saving} aria-label='Save Changes' aria-busy={form.saving}>
        {form.saving ? 'Checking and saving…' : 'Save Changes'}
      </Button>
      <Button color='neutral' variant='ghost' onClick={form.discard} disabled={form.saving}>Discard</Button>
    </div>}
  </>;
}
