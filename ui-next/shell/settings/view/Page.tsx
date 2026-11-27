import { Text } from '@omniviewdev/kit';
import type { FormStore } from '../../core/fields';
import type { SettingsPage } from '../model/adapter';
import type { ScopeSession } from '../model/session';
import { AppearanceGroups } from './AppearanceGroups';
import styles from './Page.module.css';
import { SettingRow } from './SettingRow';

export type HeadingLevel = 'h2' | 'h3';

/** One drawable page and the scope that owns every read, edit and announcement on it. */
export type PageView = SettingsPage & {
  readonly branch: 'core' | 'plugins';
  readonly form: FormStore;
  readonly session: ScopeSession;
};

export function Page({ headingLevel, page }: { readonly headingLevel: HeadingLevel; readonly page: PageView }) {
  const { form, session } = page;
  return (
    <section className={styles.page} aria-label={page.title} data-settings-part="page" data-settings-page-id={page.id}>
      <header className={styles.header}>
        <Text as={headingLevel} variant="heading">
          {page.title}{page.branch === 'plugins' ? ' plugin' : ''}
        </Text>
        {page.description === '' ? null : (
          <Text as="p" variant="caption" tone="muted">
            {page.description}
          </Text>
        )}
      </header>
      {page.branch === 'core' && page.id === 'appearance' ? (
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
