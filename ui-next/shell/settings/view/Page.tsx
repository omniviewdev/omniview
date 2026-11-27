import { Text } from '@omniviewdev/kit';
import type { FormStore } from '../../core/fields';
import type { SettingsPage } from '../model/adapter';
import { WINDOW_MATERIAL } from '../model/material';
import type { SettingsSession } from '../model/session';
import { AppearanceGroups } from './AppearanceGroups';
import styles from './Page.module.css';
import { SettingRow } from './SettingRow';

export type HeadingLevel = 'h2' | 'h3';

type PageProps = {
  readonly headingLevel: HeadingLevel;
  readonly page: SettingsPage;
  readonly form: FormStore;
  readonly session: SettingsSession;
};

/** One host category. Appearance groups the host's fields; other categories keep the host's flat list. */
export function Page({ headingLevel, page, form, session }: PageProps) {
  return (
    <section className={styles.page} aria-label={page.title} data-settings-part="page" data-settings-page-id={page.id}>
      <header className={styles.header}>
        <Text as={headingLevel} variant="heading">
          {page.title}
        </Text>
        {page.description === '' ? null : (
          <Text as="p" variant="caption" tone="muted">
            {page.description}
          </Text>
        )}
      </header>
      {page.fields.includes(WINDOW_MATERIAL) ? (
        <AppearanceGroups fields={page.fields} level={headingLevel === 'h2' ? 'h3' : 'h4'} form={form} session={session} />
      ) : (
        <div className={styles.rows} data-settings-part="rows">
          {page.fields.map((id) => (
            <SettingRow key={id} form={form} session={session} id={id} />
          ))}
        </div>
      )}
    </section>
  );
}
