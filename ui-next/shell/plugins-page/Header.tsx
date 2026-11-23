import { Button, Chip, IconButton, Status, Text, menuTrigger, useMenu, type IconName, type MenuItem } from '@omniviewdev/kit';
import { Fragment, useLayoutEffect, useRef } from 'react';
import type { Availability } from './core/availability';
import type { PluginsModel, RowView } from './core/model';
import type { Operation } from './core/types';
import { RUNNING } from './core/words';
import styles from './Header.module.css';
import { roleOf } from './StateChip';
import { Tile } from './Tile';

// The header of a plugin's detail (ch16 S133, S134; the mock's `.plug-head`): the tile, the name, the chips (version, origin, and the state LAST so that a state change moves no other chip), the action cluster, the facts and the summary.
// The cluster is three slots that never change size: the primary one (Retry, Enable or Start, or the progress while work is under way), the secondary one (Reload) and the More menu. What a state shows is chosen INSIDE a slot, so no
// button, bar or chip moves when the state changes. Every action is the model's; this file invents none.

export type HeaderProps = {
  readonly row: RowView;
  readonly model: PluginsModel;
  /** The person asked to uninstall (or unlink) the plugin: the page confirms before it calls the model. */
  readonly onUninstall: (id: string) => void;
};

/** The label of work this page started, in the words of what is going on. */
const WORKING: Readonly<Record<Operation, string>> = {
  reload: 'Reloading…',
  retry: 'Retrying…',
  enable: 'Enabling…',
  disable: 'Disabling…',
  uninstall: 'Uninstalling…',
};

type Verb = { readonly label: 'Retry' | 'Enable' | 'Start'; readonly icon: IconName; readonly availability: Availability; readonly run: (model: PluginsModel, id: string) => void };

/** The verb of the primary slot for a state: the one thing that gets the plugin going again, or none. Reload is the verb of a stopped plugin too, so the secondary slot does not repeat it. */
function verbOf(row: RowView): Verb | undefined {
  const { kind } = row.state;
  if (kind === 'failed') {
    return {
      label: 'Retry',
      icon: 'refresh',
      availability: row.actions.retry,
      run: (model, id) => {
        model.retry(id);
      },
    };
  }

  if (kind === 'disabled') {
    return {
      label: 'Enable',
      icon: 'play',
      availability: row.actions.enable,
      run: (model, id) => {
        model.enable(id);
      },
    };
  }

  if (kind === 'stopped') {
    return {
      label: 'Start',
      icon: 'play',
      availability: row.actions.reload,
      run: (model, id) => {
        model.reload(id);
      },
    };
  }

  return undefined;
}

/** The items of the More menu for a plugin: Disable while it can be, and Uninstall (Unlink for a development link) unless the product ships the plugin. Uninstall stays, unavailable, while work is under way. */
function itemsOf(row: RowView, model: PluginsModel, onUninstall: (id: string) => void): MenuItem[] {
  const items: MenuItem[] = [];
  if (row.actions.disable.available) {
    items.push({
      kind: 'action',
      id: 'disable',
      label: 'Disable',
      onSelect: () => {
        model.disable(row.id);
      },
    });
  }

  if (!row.plugin.builtin) {
    if (items.length > 0) {
      items.push({ kind: 'separator', id: 'uninstall-separator' });
    }

    items.push({
      kind: 'action',
      id: 'uninstall',
      label: row.plugin.devMode ? 'Unlink…' : 'Uninstall…',
      destructive: true,
      disabled: !row.actions.uninstall.available,
      onSelect: () => {
        onUninstall(row.id);
      },
    });
  }

  return items;
}

type ProgressProps = {
  readonly word: string;
  readonly name: string;
  /** Whether a press handed its focus to the progress; asked once, when the progress appears. */
  readonly claim: () => boolean;
  /** The progress had the focus when the work ended: the focus goes to a control that is left. */
  readonly leave: () => void;
};

/**
 * The progress that takes the primary slot while work is under way (S134): one step label over a 4 px track. It is a focusable group (tabindex -1): when the control a person pressed is replaced by it, the focus lands here instead of
 * on the body, and when the work ends and the progress goes, the focus goes back to a control of the cluster. Under reduced motion the bar is still.
 */
function Progress({ word, name, claim, leave }: ProgressProps) {
  const group = useRef<HTMLDivElement>(null);
  const latest = useRef({ claim, leave });
  useLayoutEffect(() => {
    latest.current = { claim, leave };
  });
  useLayoutEffect(() => {
    const element = group.current;
    if (element === null) {
      return undefined;
    }

    if (latest.current.claim()) {
      element.focus();
    }

    return () => {
      // This runs before the group leaves the document, so the focus is still readable here.
      if (element.contains(element.ownerDocument.activeElement)) {
        latest.current.leave();
      }
    };
  }, []);

  const label = `${word.replace(/…$/, '')} ${name}`;
  return (
    <div ref={group} className={styles.progress} role="group" aria-label={label} aria-busy="true" tabIndex={-1} data-pl-part="head-progress">
      <span className={styles.progressLabel}>{word}</span>
      <div className={styles.track} role="progressbar" aria-label={label} aria-valuetext={word}>
        <span className={styles.fill} />
      </div>
    </div>
  );
}

export function Header({ row, model, onUninstall }: HeaderProps) {
  const { plugin, state } = row;
  const busy = row.op !== null || state.busy;
  const verb = verbOf(row);
  const hasMore = row.actions.disable.available || !plugin.builtin;
  const menu = useMenu((key) => {
    const opened = key === undefined ? undefined : model.row(key);
    return opened === undefined ? undefined : itemsOf(opened, model, onUninstall);
  });
  const cluster = useRef<HTMLDivElement>(null);
  // Set by a press on a slot button, read once by the progress that replaces it: a progress that appears on its own (the host says the plugin is starting) takes no focus from anyone.
  const pressed = useRef(false);
  const facts = [plugin.publisher === '' ? '' : `by ${plugin.publisher}`, plugin.license, plugin.category].filter((text) => text !== '');

  return (
    <header className={styles.head} data-pl-part="head">
      <span className={styles.tile} data-pl-part="head-tile">
        <Tile tile={row.tile} size={28} />
      </span>
      <div className={styles.line}>
        <div className={styles.name}>
          <Text as="h2" variant="heading" data-pl-part="head-title">
            {plugin.name}
          </Text>
        </div>
        <div className={styles.actions} ref={cluster} data-pl-part="head-actions">
          <div className={styles.slot} data-pl-part="slot-primary">
            {busy ? (
              <Progress
                word={row.op === null ? `${state.word}…` : WORKING[row.op]}
                name={plugin.name}
                claim={() => {
                  const had = pressed.current;
                  pressed.current = false;
                  return had;
                }}
                leave={() => {
                  queueMicrotask(() => {
                    const root = cluster.current;
                    (root?.querySelector<HTMLElement>('button') ?? root?.closest<HTMLElement>('[data-pl-part="detail"]'))?.focus();
                  });
                }}
              />
            ) : verb === undefined ? null : (
              <Button
                variant="primary"
                icon={verb.icon}
                disabledReason={verb.availability.available ? undefined : verb.availability.reason}
                onClick={() => {
                  pressed.current = true;
                  verb.run(model, row.id);
                }}
              >
                {verb.label}
              </Button>
            )}
          </div>
          <div className={styles.slot} data-pl-part="slot-secondary">
            {row.actions.reload.available && state.kind !== 'stopped' ? (
              <Button
                icon="refresh"
                onClick={() => {
                  pressed.current = true;
                  model.reload(row.id);
                }}
              >
                Reload
              </Button>
            ) : null}
          </div>
          <div className={styles.more} data-pl-part="slot-more">
            {hasMore ? (
              <IconButton icon="ellipsis" label={`More actions for ${plugin.name}`} variant="ghost" size="row" data-pl-part="head-more" data-ov-menu-label={`Actions for ${plugin.name}`} {...menuTrigger(menu, row.id)} />
            ) : null}
          </div>
        </div>
      </div>
      <div className={styles.meta} data-pl-part="head-meta">
        {plugin.version === '' ? null : (
          <span className={styles.version} data-pl-part="head-version">
            {plugin.version}
          </span>
        )}
        {plugin.builtin ? <Chip data-pl-part="head-origin">Built-in</Chip> : plugin.devMode ? <Chip data-pl-part="head-origin">Dev-linked</Chip> : null}
        {/* The list is quiet for a plugin that runs (its row has no chip); the header always says the state, as the mock's does. */}
        <Status role={roleOf(state)} data-pl-part="head-chip">
          {state.word === '' ? RUNNING : state.word}
        </Status>
      </div>
      <p className={styles.facts} data-pl-part="facts">
        {facts.map((text, index) => (
          <Fragment key={`${String(index)}:${text}`}>
            {index === 0 ? null : (
              <span className={styles.sep} aria-hidden="true">
                {' · '}
              </span>
            )}
            {text}
          </Fragment>
        ))}
      </p>
      <p className={styles.summary} data-pl-part="summary">
        {plugin.description}
      </p>
    </header>
  );
}
