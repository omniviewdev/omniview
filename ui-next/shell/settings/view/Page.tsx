import { Text } from '@omniviewdev/kit';
import type { FormStore } from '../../core/fields';
import type { SettingsPage } from '../model/adapter';
import type { SettingsSession } from '../model/session';
import styles from './Page.module.css';
import { SettingRow } from './SettingRow';

type PageProps = {
  readonly page: SettingsPage;
  readonly form: FormStore;
  readonly session: SettingsSession;
};

/**
 * One page of Settings (ch16 S124): a heading (18/24), the category's one-line description, and the rows of its settings in the order the host gives them. Every row is drawn from the page's fields and none is written by hand.
 * Not built: the sections the mock groups rows into (the host declares none), the status slot at the end of the heading (the states it carries need a restart command and the store's own state, which the host does not say),
 * and the page menu.
 */
export function Page({ page, form, session }: PageProps) {
  return (
    <section className={styles.page} aria-label={page.title} data-settings-part="page" data-settings-page-id={page.id}>
      <header className={styles.header}>
        <Text as="h3" variant="heading">
          {page.title}
        </Text>
        {page.description === '' ? null : (
          <Text as="p" variant="caption" tone="muted">
            {page.description}
          </Text>
        )}
      </header>
      <div className={styles.rows} data-settings-part="rows">
        {page.fields.map((id) => (
          <SettingRow key={id} form={form} session={session} id={id} />
        ))}
      </div>
    </section>
  );
}
