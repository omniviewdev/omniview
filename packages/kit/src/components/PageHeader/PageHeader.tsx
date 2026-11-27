import { useLayoutEffect, useRef } from 'react';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import { Button } from '../Button';
import { Icon, type IconName } from '../Icon';
import { IconButton } from '../IconButton';
import { KindTile, type KindTileTone } from '../KindTile';
import { menuTrigger, useMenu } from '../Menu';
import { Status, type StatusRole } from '../Status';
import { laneMode } from './lane';
import { isDisabled, overflowItems, type OverflowEntry } from './overflow';
import type { PageOperation } from './operation';
import styles from './PageHeader.module.css';
import { PageOperationView } from './PageOperation';

/** A command of the header: a native button named by its label. */
export type PageHeaderCommand = {
  /** Names the command among the others, stably. An overflow item with the same id is dropped: a menu never repeats a button. */
  readonly id: string;
  /** The verb, in sentence case. It names the button (an icon-only utility is named by it too). */
  readonly label: string;
  readonly onSelect: () => void;
  /** A glyph before the label (the utility is only a glyph: its default is the refresh glyph). */
  readonly icon?: IconName | undefined;
  /** Why the command cannot be used now. The button stays focusable and does nothing; the first reason of a labelled command is also written in the identity line (design 14 P2). */
  readonly disabledReason?: string | undefined;
  /** The command's own request is in flight: `aria-busy` at once, and the loader after a second. */
  readonly busy?: boolean | undefined;
};

/** An item of the overflow menu: the kit Menu's action fields (`icon`, `disabled` as a flag or a reason, `destructive`) and an optional separator before it. */
export type PageHeaderMenuItem = OverflowEntry;

/** The commands of the header, in the one order the design allows (design 12 PH2): they are drawn in this order and no other. */
export type PageHeaderCommands = {
  /** At most one, filled. */
  readonly primary?: PageHeaderCommand | undefined;
  /** At most two are drawn, labelled and bordered; the rest go into the overflow menu. */
  readonly secondary?: readonly PageHeaderCommand[] | undefined;
  /** Bordered, with a red label, never filled; the last of the labelled commands. */
  readonly danger?: PageHeaderCommand | undefined;
  /** One icon-only command, Refresh, before the overflow. */
  readonly utility?: PageHeaderCommand | undefined;
  /** The overflow menu's items. The trigger is always the last control; with no item left there is no trigger. */
  readonly menu?: readonly PageHeaderMenuItem[] | undefined;
};

/** One part of the path. The last is the page itself. */
export type PageHeaderCrumb = {
  readonly label: string;
  /** Makes the part a link (a native button); a part with nowhere to go is text. */
  readonly onSelect?: (() => void) | undefined;
};

type PageHeaderProgressState = { readonly role: 'progress'; readonly queued?: boolean | undefined };
type PageHeaderStaticState = { readonly role: Exclude<StatusRole, 'progress'> };

/** The lifecycle state, first in the identity line: the platform's own word and the role that chooses its glyph (design 13 SR1). */
export type PageHeaderState = { readonly label: string } & (PageHeaderProgressState | PageHeaderStaticState);

/** A fact of the identity line: its text, optionally a glyph before it and a Copy button after it. */
export type PageHeaderFact = {
  readonly text: string;
  /** An identifier or another run in the code face. */
  readonly mono?: boolean | undefined;
  readonly icon?: IconName | undefined;
  /** A Copy button named "Copy <label>", whole when the text is cut. The caller copies: the kit reaches no clipboard. */
  readonly copy?: { readonly label: string; readonly onCopy: () => void } | undefined;
};

export type PageHeaderProps = {
  /** The page's title: its one h1 (level 1). A header with no title is refused: a page with no h1 is a defect (design 12 PH1). */
  readonly title: string;
  /** A muted secondary run in the same heading ("checkout"). */
  readonly subtitle?: string | undefined;
  /** 1 for a page; 2 to 4 only for a specimen, because a page has exactly one h1. */
  readonly level?: 1 | 2 | 3 | 4 | undefined;
  /** The back path: a breadcrumb above the title. */
  readonly path?: readonly PageHeaderCrumb[] | undefined;
  /** The tile of the page's kind, 20 px before the title: it differs by kind (design 13 GL1). */
  readonly tile?: { readonly icon: IconName; readonly tone?: KindTileTone | undefined } | undefined;
  /** The lifecycle state, first in the identity line. */
  readonly state?: PageHeaderState | undefined;
  /** At most four facts after the state (an id, a kind, a group, an age); more are not drawn. */
  readonly facts?: readonly PageHeaderFact[] | undefined;
  /** One plain muted line instead of facts (a flow's "Name and group · step 1 of 3"). */
  readonly note?: string | undefined;
  readonly commands?: PageHeaderCommands | undefined;
  /**
   * The operation slot. Absent: there is no slot. `null`: the slot, at rest: no width and no line of its own, the anchor at the end of the identity
   * line (of the title row when the header has none). A record: its presenter shows in the slot, 360 px wide (480 px from 1000 px of page width), and
   * nothing below the header moves when it starts, ends, fails, retries or clears.
   */
  readonly operation?: PageOperation | null | undefined;
  /** Names the group of commands; "<title> commands" when it is not given. */
  readonly label?: string | undefined;
} & DataAttributes;

const MAX_SECONDARY = 2;
const MAX_FACTS = 4;

type OverflowProps = {
  readonly title: string;
  readonly entries: readonly OverflowEntry[];
  readonly visible: ReadonlySet<string>;
};

/** Overflow registers its own commands; the window's menu host opens and draws them. */
function Overflow({ title, entries, visible }: OverflowProps) {
  const name = `More actions for ${title}`;
  const latest = useRef({ entries, visible });
  useLayoutEffect(() => {
    latest.current = { entries, visible };
  }, [entries, visible]);

  const revision = JSON.stringify([
    title,
    entries.filter((entry) => !visible.has(entry.id)).map(({ id, label, icon, disabled, destructive, separatorBefore }) => [id, label, icon ?? null, disabled ?? false, destructive === true, separatorBefore === true]),
  ]);
  const id = useMenu(
    () => overflowItems(entries, visible, (key) => {
      const current = latest.current;
      if (current.visible.has(key)) {
        return;
      }

      const entry = current.entries.find((candidate) => candidate.id === key);
      if (entry !== undefined && !isDisabled(entry)) {
        entry.onSelect();
      }
    }),
    revision,
  );
  return <IconButton icon="ellipsis" label={name} data-ov-tip={name} data-ov-menu-label={`Actions for ${title}`} {...menuTrigger(id)} />;
}

function Labelled({ command, variant, tone }: { readonly command: PageHeaderCommand; readonly variant: 'primary' | 'secondary'; readonly tone?: 'danger' }) {
  return (
    <Button variant={variant} tone={tone} icon={command.icon} busy={command.busy} disabledReason={command.disabledReason} onClick={command.onSelect}>
      {command.label}
    </Button>
  );
}

/** The first reason a labelled command cannot be used: it is written in the identity line. The utility's is not: it would add a line when it comes and goes. */
function firstReason(commands: ReadonlyArray<PageHeaderCommand | undefined>): string | undefined {
  for (const command of commands) {
    const reason = command?.disabledReason?.trim();
    if (reason !== undefined && reason !== '') {
      return reason;
    }
  }

  return undefined;
}

const HEADINGS = ['h1', 'h2', 'h3', 'h4'] as const;

/**
 * The header of a page (design 12 PH1 to PH3; the mock's `H.pageHeader`): a breadcrumb, a row with the kind tile, the one h1 and the commands,
 * and one identity line that holds the state, at most four facts, the first reason a command cannot be used and the operation slot. The commands
 * are in one fixed order, primary, at most two secondaries, danger, the Refresh utility, the overflow menu last; the identity line is one 28 px
 * line that never wraps. Overflow commands use the window's `MenuHost`. Props are closed: no `className`, no `style`; `data-*` passes through.
 */
export function PageHeader({ title, subtitle, level = 1, path, tile, state, facts, note, commands, operation, label, ...rest }: PageHeaderProps) {
  if (title.trim() === '') {
    throw new TypeError('PageHeader needs a title: a page with no h1 is a defect');
  }

  const Heading = HEADINGS[level - 1] ?? 'h1';

  const primary = commands?.primary;
  const danger = commands?.danger;
  const utility = commands?.utility;
  const secondary = commands?.secondary ?? [];
  const drawn = secondary.slice(0, MAX_SECONDARY);
  const visible = new Set([primary, ...drawn, danger, utility].flatMap((command) => (command === undefined ? [] : [command.id])));
  const moved = secondary.slice(MAX_SECONDARY).map((command): OverflowEntry => ({ id: command.id, label: command.label, icon: command.icon, onSelect: command.onSelect, disabled: command.disabledReason }));
  const entries = [...moved, ...(commands?.menu ?? [])];
  const hasOverflow = entries.some((entry) => !visible.has(entry.id));

  const labelled = [primary, ...drawn, danger].flatMap((command) => (command === undefined ? [] : [command]));
  const icons = (utility === undefined ? 0 : 1) + (hasOverflow ? 1 : 0);
  const hasLane = labelled.length + icons > 0;
  const mode = labelled.length === 0 && icons === 1 ? 'icon-only' : laneMode({
    labels: labelled.map((command) => command.label),
    icons,
    titleLength: title.length + (subtitle === undefined ? 0 : subtitle.length + 1),
    hasTile: tile !== undefined,
  });

  const reason = firstReason([primary, ...drawn, danger]);
  const shownFacts = (facts ?? []).slice(0, MAX_FACTS);
  const plainNote = note !== undefined && note.trim() !== '' ? note : undefined;
  const identity = state !== undefined || shownFacts.length > 0 || reason !== undefined;
  const hasMeta = identity || plainNote !== undefined;
  const declared = operation !== undefined;
  const open = operation !== undefined && operation !== null;
  const slot = declared ? (
    <div className={styles.slot} data-ov-slot="" data-ov-open={open ? '' : undefined}>
      {open ? <PageOperationView operation={operation} /> : null}
    </div>
  ) : null;
  const inLine = declared && identity;
  const inRow = declared && !identity;

  return (
    <header {...dataAttributes(rest)} className={styles.root} data-ov-lane={mode}>
      {path === undefined || path.length === 0 ? null : (
        <nav className={styles.crumbs} aria-label="Breadcrumb">
          <ol className={styles.crumbList}>
            {path.map((crumb, index) => {
              const last = index === path.length - 1;
              return (
                <li key={`${String(index)}:${crumb.label}`} className={styles.crumb}>
                  {last ? (
                    <span aria-current="page">{crumb.label}</span>
                  ) : crumb.onSelect === undefined ? (
                    <span>{crumb.label}</span>
                  ) : (
                    <button type="button" className={styles.crumbLink} onClick={crumb.onSelect}>
                      {crumb.label}
                    </button>
                  )}
                  {last ? null : <Icon name="chevron-right" size={12} />}
                </li>
              );
            })}
          </ol>
        </nav>
      )}
      <div className={styles.row} data-ov-row="" data-ov-tile={tile === undefined ? undefined : ''} data-ov-slot-row={inRow ? '' : undefined}>
        {tile === undefined ? null : <KindTile data-ov-header-tile="" icon={tile.icon} tone={tile.tone} size={20} />}
        <Heading className={styles.title} tabIndex={level === 1 ? -1 : undefined} data-ov-clip="">
          {title}
          {subtitle === undefined ? null : (
            <>
              {' '}
              <span className={styles.subtitle}>{subtitle}</span>
            </>
          )}
        </Heading>
        {hasMeta ? (
          <div className={styles.meta} data-ov-meta="" data-ov-line={identity ? undefined : 'plain'} data-ov-op={inLine && open ? '' : undefined}>
            {state === undefined ? null : (
              <span className={styles.state} data-ov-state-chip="">
                {state.role === 'progress' ? (
                  <Status role="progress" queued={state.queued}>
                    {state.label}
                  </Status>
                ) : (
                  <Status role={state.role}>{state.label}</Status>
                )}
              </span>
            )}
            {shownFacts.length === 0 ? null : (
              <span className={styles.facts}>
                {shownFacts.map((fact, index) => (
                  <span key={`${String(index)}:${fact.text}`} className={styles.fact} data-ov-fact="" data-ov-mono={fact.mono === true ? '' : undefined}>
                    {fact.icon === undefined ? null : <Icon name={fact.icon} />}
                    <span className={styles.factText} data-ov-clip="">
                      {fact.text}
                    </span>
                    {fact.copy === undefined ? null : <IconButton icon="copy" label={`Copy ${fact.copy.label}`} variant="ghost" onClick={fact.copy.onCopy} />}
                  </span>
                ))}
              </span>
            )}
            {plainNote === undefined ? null : <span className={styles.note}>{plainNote}</span>}
            {reason === undefined ? null : (
              <span className={styles.reason} data-ov-reason="" data-ov-clip="">
                {reason}
              </span>
            )}
            {inLine ? slot : null}
          </div>
        ) : null}
        {inRow ? slot : null}
        {hasLane ? (
          <div className={styles.commands} role="group" aria-label={label ?? `${title} commands`}>
            {primary === undefined ? null : <Labelled command={primary} variant="primary" />}
            {drawn.map((command) => (
              <Labelled key={command.id} command={command} variant="secondary" />
            ))}
            {danger === undefined ? null : <Labelled command={danger} variant="secondary" tone="danger" />}
            {utility === undefined ? null : (
              <IconButton
                icon={utility.icon ?? 'refresh'}
                label={utility.label}
                busy={utility.busy}
                disabledReason={utility.disabledReason}
                onClick={utility.onSelect}
                data-ov-tip={utility.label}
              />
            )}
            {hasOverflow ? <Overflow title={title} entries={entries} visible={visible} /> : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}
