import { Button, Text } from '@omniviewdev/kit';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { useAppearanceCapabilities } from '../../../appearance';
import type { FormStore } from '../../core/fields';
import { GLASS_STYLE, MATERIAL_FIELDS, materialResetBlock, SURFACE_OPACITIES, WINDOW_MATERIAL } from '../model/material';
import type { SettingsSession } from '../model/session';
import styles from './Page.module.css';
import { SettingRow } from './SettingRow';

type GroupLevel = 'h3' | 'h4';

function Group({ title, level, children }: { readonly title: string; readonly level: GroupLevel; readonly children: ReactNode }) {
  return (
    <section className={styles.group} data-settings-group={title}>
      <Text as={level} variant="title" data-settings-part="section-title">{title}</Text>
      <div className={styles.rows} data-settings-part="rows">{children}</div>
    </section>
  );
}

function ResetMaterial({ form, session }: { readonly form: FormStore; readonly session: SettingsSession }) {
  const blocked = useSyncExternalStore(form.subscribe, () => materialResetBlock(form));
  const [failed, setFailed] = useState(false);
  return (
    <div className={styles.reset}>
      <Button
        size="row"
        icon="rotate-ccw"
        data-settings-part="reset-material"
        disabledReason={blocked}
        onClick={async () => {
          setFailed(false);
          setFailed(!(await session.resetMaterial()));
        }}
      >
        Reset material settings
      </Button>
      {failed ? <span role="alert">Couldn’t reset material settings.</span> : null}
    </div>
  );
}

type AppearanceProps = {
  readonly fields: readonly string[];
  readonly level: GroupLevel;
  readonly form: FormStore;
  readonly session: SettingsSession;
};

/** Shared by the native window and the sheet. Capabilities lock controls; they never rewrite a saved preference. */
export function AppearanceGroups({ fields, level, form, session }: AppearanceProps) {
  const { glass, translucent, forcedOpaque } = useAppearanceCapabilities();
  const solid = forcedOpaque || !translucent ? 'Transparency unavailable.' : undefined;
  const rest = fields.filter((id) => !(MATERIAL_FIELDS as readonly string[]).includes(id));
  return (
    <>
      <Group title="Window material" level={level}>
        <SettingRow id={WINDOW_MATERIAL} form={form} session={session} concise rollback unavailableOption={(value) => (value === 'glass' && !glass) || (value === 'translucent' && !translucent)} />
        <SettingRow id={GLASS_STYLE} form={form} session={session} concise rollback disabledReason={glass ? solid : 'Liquid Glass unavailable.'} />
      </Group>
      <Group title="Surface opacity" level={level}>
        {SURFACE_OPACITIES.map((id) => <SettingRow key={id} id={id} form={form} session={session} concise rollback disabledReason={solid} />)}
        <ResetMaterial form={form} session={session} />
      </Group>
      {rest.length > 0 ? (
        <Group title="Interface" level={level}>
          {rest.map((id) => <SettingRow key={id} id={id} form={form} session={session} concise />)}
        </Group>
      ) : null}
    </>
  );
}
