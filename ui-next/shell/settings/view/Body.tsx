import { Button, Text } from '@omniviewdev/kit';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { FormStore } from '../../core/fields';
import type { PageMemory } from '../host';
import type { SettingsModel } from '../model/adapter';
import type { SettingsSession } from '../model/session';
import { Nav } from './Nav';
import { Page, type HeadingLevel } from './Page';
import styles from './Body.module.css';

type ReadyProps = {
  readonly headingLevel: HeadingLevel;
  readonly model: SettingsModel;
  readonly form: FormStore;
  readonly session: SettingsSession;
  readonly memory: PageMemory;
};

/** The page to open on: the one Settings was last on in this window when it is still there, else the first. */
function firstPage(model: SettingsModel, memory: PageMemory): string | undefined {
  const last = memory.get();
  return model.pages.some((page) => page.id === last) ? last : model.pages[0]?.id;
}

/** A refused draft does not outlive its field (S125): the page being entered starts from what the host has applied, so a value the host refused when the page was left is not found waiting on the way back. */
function dropRefused(form: FormStore, ids: readonly string[]): void {
  for (const id of ids) {
    const field = form.field(id);
    if (field?.dirty === true && field.validation === 'invalid') {
      form.revert(id);
    }
  }
}

function Ready({ headingLevel, model, form, session, memory }: ReadyProps) {
  const [selected, setSelected] = useState(() => firstPage(model, memory));
  const layout = useRef<HTMLDivElement>(null);
  const page = model.pages.find((candidate) => candidate.id === selected) ?? model.pages[0];
  // Settings opens with the keyboard on its navigation, on the page that is on screen: the arrows move between pages from the first key.
  useEffect(() => {
    layout.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus({ preventScroll: true });
  }, []);

  if (page === undefined) {
    return (
      <div className={styles.state} data-settings-part="state" data-settings-state="empty">
        <Text>The host has no settings to show.</Text>
      </div>
    );
  }

  return (
    <div ref={layout} className={styles.layout} data-settings-part="layout">
      <Nav
        pages={model.pages}
        selected={page.id}
        onSelect={(id) => {
          const entered = model.pages.find((candidate) => candidate.id === id);
          if (entered === undefined || entered.id === page.id) {
            return;
          }

          dropRefused(form, entered.fields);
          setSelected(id);
          memory.set(id);
        }}
      />
      {/* Keyed by the page, so that each page opens at its top: the pane that scrolls is a new element. */}
      <div key={page.id} className={styles.content} data-settings-part="content">
        <Page page={page} form={form} session={session} headingLevel={headingLevel} />
      </div>
    </div>
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
  const said = useSyncExternalStore(session.announcements.subscribe, session.announcements.getSnapshot);
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
      <div className={styles.live} role="status" aria-live="polite" data-settings-part="live">
        {said.text}
      </div>
    </div>
  );
}
