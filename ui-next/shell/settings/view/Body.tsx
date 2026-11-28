import { Button, Text } from '@omniviewdev/kit';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { FormStore } from '../../core/fields';
import type { PageMemory } from '../host';
import type { SettingsModel } from '../model/adapter';
import type { SessionState, SettingsSession } from '../model/session';
import { Nav, type NavNotice } from './Nav';
import { Page, type HeadingLevel, type PageView } from './Page';
import { focusSetting } from './SettingRow';
import styles from './Body.module.css';

type ReadyProps = {
  readonly headingLevel: HeadingLevel;
  readonly model: SettingsModel;
  readonly form: FormStore;
  readonly session: SettingsSession;
  readonly memory: PageMemory;
};

/** A refused draft does not outlive its field (S125): the page being entered starts from what the host has applied, so a value the host refused when the page was left is not found waiting on the way back. */
function dropRefused(form: FormStore, ids: readonly string[]): void {
  for (const id of ids) {
    const field = form.field(id);
    // A secret the host refused is no validation: the field still holds the typed text in the form's vault and reads "Changed" over an input that looks empty. It never outlives its view: the text stays in the input while the person is on the page and is gone when the page is entered again.
    if (field !== undefined && ((field.dirty && field.validation === 'invalid') || field.secret?.changed === true)) {
      form.revert(id);
    }
  }
}

function clearSecrets(model: SettingsModel, form: FormStore): void {
  for (const page of model.pages) {
    for (const id of page.fields) {
      if (form.field(id)?.secret?.changed === true) {
        form.revert(id);
      }
    }
  }
}

function Ready({ headingLevel, model, form, session, memory }: ReadyProps) {
  const plugins = useSyncExternalStore(session.plugins.subscribe, session.plugins.getSnapshot);
  const { pages, notices, loading, unavailable } = useMemo(() => {
    const pages: PageView[] = model.pages.map(page => ({ ...page, branch: 'core', form, session }));
    const notices: NavNotice[] = [];
    const unavailable = new Map<string, Exclude<SessionState, { phase: 'ready' }>>();
    let loading = plugins.phase === 'loading';
    if (plugins.phase === 'failed') {
      notices.push({ id: 'notice:inventory', label: 'Couldn’t list plugins. Retry', retry: session.plugins.refresh });
    }

    for (const plugin of plugins.entries) {
      const state = plugin.session.getState();
      if (state.phase !== 'ready') {
        unavailable.set(plugin.id, state);
      }

      if (state.phase === 'loading') {
        loading = true;
        if (state.warning) {
          notices.push({ id: `warning:${plugin.id}`, label: `${plugin.title}: ${state.warning}` });
        }
      } else if (state.phase === 'failed') {
        const message = state.warning ? `${plugin.title}: ${state.warning}` : `Couldn’t load settings for ${plugin.title}.`;
        notices.push({ id: `retry:${plugin.id}`, label: `${message} Retry`, retry: plugin.session.load });
      } else {
        const declared = state.model.pages[0];
        if (declared) {
          pages.push({
            id: plugin.id,
            title: plugin.title,
            description: plugin.description,
            icon: plugin.icon,
            fields: declared.fields,
            branch: 'plugins',
            form: state.form,
            session: plugin.session,
          });
        }
      }
    }

    if (loading) {
      notices.push({ id: 'notice:loading', label: 'Loading plugin settings…' });
    }

    return { pages, notices, loading, unavailable };
  }, [model, form, session, plugins]);

  const [selected, setSelected] = useState<string | undefined>(() => memory.get() ?? pages[0]?.id);
  const wanted = pages.find(candidate => candidate.id === selected);
  const selectedState = selected === undefined ? undefined : unavailable.get(selected);
  const warning = selectedState?.warning;
  // Keep a recovering plugin selected, including while its Retry action is available.
  const waiting = selected !== undefined && selected.startsWith('plugin/') && (plugins.phase === 'loading' || selectedState?.phase === 'loading' || warning !== undefined);
  const page = wanted ?? (waiting ? undefined : pages[0]);
  const pageId = page?.id;
  if (!waiting && pageId !== selected) {
    setSelected(pageId);
  }

  useEffect(() => {
    if (pageId !== undefined) {
      memory.set(pageId);
    }
  }, [memory, pageId]);

  const layout = useRef<HTMLDivElement>(null);
  const opening = useRef(true);
  // Sheet opens the native dialog in its layout effect. Focus the page only after it is focusable.
  useEffect(() => {
    if (pageId === undefined || (!opening.current && document.activeElement !== document.body)) {
      return;
    }

    opening.current = false;
    // A search begun while discovery was running keeps the keyboard.
    if (!layout.current?.contains(document.activeElement)) {
      layout.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus();
    }
  }, [pageId]);

  // A fresh Body (including a new native request) cannot inherit a secret from an input that no longer exists.
  useEffect(() => {
    clearSecrets(model, form);
    for (const plugin of session.plugins.getSnapshot().entries) {
      const state = plugin.session.getState();
      if (state.phase === 'ready') {
        clearSecrets(state.model, state.form);
      }
    }
  }, [form, model, session]);

  const select = (id: string) => {
    if (id === pageId) {
      return;
    }

    const entered = pages.find(candidate => candidate.id === id);
    if (!entered) {
      return;
    }

    dropRefused(entered.form, entered.fields);
    setSelected(id);
  };

  const [jump, setJump] = useState<{ readonly page: string; readonly field: string | undefined }>();
  useLayoutEffect(() => {
    if (!jump || !layout.current) {
      return;
    }

    const pageItem = layout.current.querySelector<HTMLElement>('[data-settings-page][aria-current="page"]');
    if (pageItem?.dataset.settingsPage !== jump.page) {
      return;
    }

    pageItem.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    if (jump.field !== undefined) {
      // Plugin field IDs are opaque, so never interpolate one into a selector.
      for (const row of layout.current.querySelectorAll<HTMLElement>('[data-settings-row]')) {
        if (row.dataset.settingsRow === jump.field) {
          focusSetting(row);
          row.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
          return;
        }
      }
    }

    pageItem.focus({ preventScroll: true });
  }, [jump]);
  const announcements = (page?.session ?? session).announcements;
  const said = useSyncExternalStore(announcements.subscribe, announcements.getSnapshot);
  const pageState = selectedState?.phase === 'failed' && warning ? 'unavailable' : loading ? 'loading' : notices.length > 0 ? 'unavailable' : 'empty';

  return (
    <>
      <div ref={layout} className={styles.layout} data-settings-part="layout">
        <Nav
          pages={pages}
          notices={notices}
          selected={pageId}
          onSelect={select}
          onResult={(id, field) => {
            select(id);
            setJump({ page: id, field });
          }}
        />
        {/* Each page starts at its top, without moving the sidebar. */}
        <div key={pageId} className={styles.content} data-settings-part="content">
          {page ? <Page page={page} headingLevel={headingLevel} /> : (
            <div className={styles.state} role="status" data-settings-part="state" data-settings-state={pageState}>
              {pageState === 'loading' ? <Text tone="muted">{warning ?? 'Loading settings…'}</Text> : (
                <Text>{pageState === 'empty' ? 'The host has no settings to show.' : `${warning ?? 'Couldn’t load plugin settings.'} Retry from the sidebar.`}</Text>
              )}
            </div>
          )}
        </div>
      </div>
      <div className={styles.live} role="status" aria-live="polite" data-settings-part="live">{said.text}</div>
    </>
  );
}

function Failed({ session }: { readonly session: SettingsSession }) {
  const state = useRef<HTMLDivElement>(null);
  // The one thing to do is the thing the keyboard is on.
  useEffect(() => {
    state.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }, []);

  return (
    <div ref={state} className={styles.state} role="alert" data-settings-part="state" data-settings-state="failed">
      <Text variant="title">Couldn’t load settings</Text>
      <Text tone="muted" variant="caption">
        Omniview didn’t answer. Try again.
      </Text>
      <Button
        icon="refresh"
        data-settings-part="retry"
        onClick={() => {
          session.load();
        }}
      >
        Retry
      </Button>
    </div>
  );
}

export type BodyProps = {
  readonly session: SettingsSession;
  readonly page: PageMemory;
  /** The level of the page's heading: the one under the container's own title (the sheet's is an h2, the window's an h1). */
  readonly headingLevel: HeadingLevel;
};

/**
 * What Settings is, in whichever container holds it (the sheet in a window with no native windows, the Settings window where there are): the pages on the left and the page on the right, or loading, or failed with Retry, or
 * nothing to show, from the session; and a polite live region of its own that says what the form announces (S127). One component, so that the two containers cannot differ in what they draw.
 */
export function Body({ session, page: memory, headingLevel }: BodyProps) {
  const state = useSyncExternalStore(session.subscribe, session.getState);
  // A page that was not looking (a laptop that slept, a tab in the background, a dropped events connection that came back) asks the host again when it is looked at: the host's `settings/changed` is not replayed.
  useEffect(() => {
    const ask = (): void => {
      if (document.visibilityState === 'visible') {
        session.refresh();
      }
    };

    document.addEventListener('visibilitychange', ask);
    window.addEventListener('focus', ask);
    window.addEventListener('online', ask);
    return () => {
      document.removeEventListener('visibilitychange', ask);
      window.removeEventListener('focus', ask);
      window.removeEventListener('online', ask);
    };
  }, [session]);
  return (
    <div className={styles.body}>
      {state.phase === 'ready' ? (
        <Ready headingLevel={headingLevel} model={state.model} form={state.form} session={session} memory={memory} />
      ) : state.phase === 'failed' ? (
        <Failed session={session} />
      ) : (
        <div className={styles.state} role="status" data-settings-part="state" data-settings-state="loading">
          <Text tone="muted">Loading settings…</Text>
        </div>
      )}
    </div>
  );
}
