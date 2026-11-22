import { Button, Sheet, Text } from '@omniviewdev/kit';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { FormStore } from '../../core/fields';
import type { PageMemory, SurfaceProps } from '../host';
import type { SettingsModel } from '../model/adapter';
import type { SettingsSession } from '../model/session';
import { Nav } from './Nav';
import { Page } from './Page';
import styles from './Surface.module.css';

type ReadyProps = {
  readonly model: SettingsModel;
  readonly form: FormStore;
  readonly session: SettingsSession;
  readonly memory: PageMemory;
};

/** The page to open on: the one the sheet was last on in this window when it is still there, else the first. */
function firstPage(model: SettingsModel, memory: PageMemory): string | undefined {
  const last = memory.get();
  return model.pages.some((page) => page.id === last) ? last : model.pages[0]?.id;
}

function Ready({ model, form, session, memory }: ReadyProps) {
  const [selected, setSelected] = useState(() => firstPage(model, memory));
  const layout = useRef<HTMLDivElement>(null);
  const page = model.pages.find((candidate) => candidate.id === selected) ?? model.pages[0];
  // The sheet opens with the keyboard on its navigation, on the page that is on screen: the arrows move between pages from the first key.
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
          setSelected(id);
          memory.set(id);
        }}
      />
      <div className={styles.content} data-settings-part="content">
        <Page key={page.id} page={page} form={form} session={session} />
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
      <Text tone="muted">Omniview didn’t answer. Try again.</Text>
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

/**
 * The Settings sheet (the owner's ruling of 2026-11-22: a separate sheet like the original application, whose Settings is one window of 1060 x 640 px with its pages on the left and a page on the right): the kit's modal
 * `Sheet` around the pages and the page on screen. What it draws comes from the session: loading, failed with Retry, or the model the host's snapshot made. It is mounted when it opens and goes with everything it started when
 * it closes. A polite live region of its own says what the form announces (S127): the window's are behind the modal.
 */
export function Surface({ session, page: memory, onClose }: SurfaceProps) {
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const said = useSyncExternalStore(session.announcements.subscribe, session.announcements.getSnapshot);
  return (
    <Sheet title="Settings" onClose={onClose} data-settings-part="sheet">
      <div className={styles.body}>
        {state.phase === 'ready' ? (
          <Ready model={state.model} form={state.form} session={session} memory={memory} />
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
    </Sheet>
  );
}
