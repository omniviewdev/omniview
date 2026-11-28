import { useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { Icon } from '../Icon';
import { KeyHint } from '../KeyHint';
import { rowAt, type MenuController, type MenuLevel, type MenuView } from './controller';
import type { MenuKeyHint, MenuModel, MenuRow } from './items';
import { placeMenu, type MenuPlacement, type MenuPosition } from './placement';
import styles from './Menu.module.css';

type Expanded = { readonly index: number; readonly id: string };

function MenuButton({ row, expanded }: { readonly row: MenuRow; readonly expanded: Expanded | undefined }): ReactElement {
  const { entry, reason, submenu } = row;
  const metadata = typeof entry.metadata === 'string' ? entry.metadata : entry.metadata?.text;
  const metadataIcon = typeof entry.metadata === 'object' ? entry.metadata.icon : undefined;
  const radio = row.role === 'menuitemradio';
  const description = [reason, entry.destructive === true ? 'Destructive action' : undefined, metadata, entry.shortcut];
  for (const hint of entry.hints ?? []) {
    description.push(`${hint.spokenKeys ?? hint.keys}: ${hint.label}`);
  }

  const described = description.filter(Boolean).join('; ');
  return (
    <button
      type="button"
      role={row.role}
      tabIndex={-1}
      className={styles.item}
      data-ov-menu-item={row.index}
      data-ov-destructive={entry.destructive === true ? '' : undefined}
      data-ov-tip={reason}
      aria-label={entry.label}
      aria-description={described || undefined}
      aria-disabled={row.disabled || undefined}
      aria-checked={row.checked}
      aria-haspopup={submenu === undefined ? undefined : 'menu'}
      aria-expanded={submenu === undefined ? undefined : expanded !== undefined}
      aria-controls={expanded?.id}
    >
      {row.checked === true || row.checked === 'mixed' ? (
        <span className={styles.mark} data-ov-menu-mark="" data-ov-menu-radio={radio ? '' : undefined} aria-hidden="true">
          {radio ? null : <Icon name={row.checked === 'mixed' ? 'minus' : 'check'} />}
        </span>
      ) : null}
      {entry.icon === undefined ? null : (
        <span className={styles.icon} data-ov-menu-icon="">
          <Icon name={entry.icon} />
        </span>
      )}
      <span className={styles.label} data-ov-menu-clip="">{entry.label}</span>
      {entry.metadata === undefined ? null : (
        <span className={styles.metadata} data-ov-menu-metadata="" data-ov-metadata-icon={metadataIcon === undefined ? undefined : ''}>
          {metadataIcon === undefined ? null : <Icon name={metadataIcon} />}
          <span className={styles.metadataText} data-ov-menu-clip="">{metadata}</span>
        </span>
      )}
      {entry.shortcut === undefined ? null : <span className={styles.shortcut}><KeyHint keys={entry.shortcut} /></span>}
      {submenu === undefined ? null : <span className={styles.arrow}><Icon name="chevron-right" /></span>}
    </button>
  );
}

type RowsProps = { readonly nodes: MenuModel['nodes']; readonly expanded: Expanded | undefined };

function MenuRows({ nodes, expanded }: RowsProps): ReactElement {
  return (
    <>
      {nodes.map((node) => {
        if (node.kind === 'row') {
          return <MenuButton key={node.row.entry.id} row={node.row} expanded={node.row.index === expanded?.index ? expanded : undefined} />;
        }

        if (node.kind === 'separator') {
          return <div key={node.id} role="separator" className={styles.separator} />;
        }

        return (
          <div key={node.id} role="group" className={styles.group} aria-label={node.label}>
            {node.label === undefined ? null : <div className={styles.title} data-ov-menu-title="" aria-hidden="true">{node.label}</div>}
            <MenuRows nodes={node.children} expanded={expanded} />
          </div>
        );
      })}
    </>
  );
}

function Hints({ hints }: { readonly hints: readonly MenuKeyHint[] | undefined }): ReactElement {
  return (
    <span className={styles.hints}>
      {hints?.map((hint) => (
        <KeyHint key={`${hint.keys}:${hint.label}`} keys={hint.keys} label={hint.label} />
      ))}
    </span>
  );
}

type PanelProps = {
  readonly controller: MenuController;
  readonly level: MenuLevel;
  readonly view: MenuView;
  readonly parentPlaced?: boolean;
};

function positionOf(level: MenuLevel, mode: MenuView['mode'], popup: HTMLDivElement): MenuPosition {
  const position = level.position;
  if (position.kind === 'point') {
    return position;
  }

  if (position.kind === 'trigger') {
    return { kind: 'trigger', rect: position.element.getBoundingClientRect(), align: mode === 'dropdown' ? 'end' : 'start' };
  }

  const side = position.panel.getAttribute('data-ov-side');
  const win = popup.ownerDocument.defaultView;
  const border = Number.parseFloat(win?.getComputedStyle(popup).borderTopWidth ?? '') || 1;
  const first = popup.querySelector<HTMLElement>('[data-ov-menu-item]:not([aria-disabled="true"])') ??
    popup.querySelector<HTMLElement>('[data-ov-menu-item]');
  const offset = first?.offsetTop ?? 0;
  const lead = border + (offset > 0 ? offset : mode === 'dropdown' ? 8 : 6);
  return {
    kind: 'branch',
    panel: position.panel.getBoundingClientRect(),
    rowTop: position.row.getBoundingClientRect().top,
    lead,
    side: side === 'left' || side === 'right' ? side : undefined,
  };
}

/** Compute the tip once at the final width, before the button receives keyboard focus. */
function describeClippedRows(popup: HTMLDivElement, level: MenuLevel) {
  for (const button of popup.querySelectorAll<HTMLButtonElement>('[data-ov-menu-item]')) {
    let tip = rowAt(level, button)?.reason;
    for (const part of button.querySelectorAll<HTMLElement>('[data-ov-menu-clip]')) {
      const text = part.textContent;
      if (text && part.scrollWidth > part.clientWidth + 1) {
        tip = tip ? `${tip}\n${text}` : text;
      }
    }

    if (tip !== undefined && button.getAttribute('data-ov-tip') !== tip) {
      button.setAttribute('data-ov-tip', tip);
    } else if (tip === undefined && button.hasAttribute('data-ov-tip')) {
      button.removeAttribute('data-ov-tip');
    }
  }
}

export function MenuPanel({ controller, level, view, parentPlaced = true }: PanelProps): ReactElement {
  const { ownerId, mode, rtl } = view;
  const child = view.levels[level.depth + 1];
  const ref = useRef<HTMLDivElement>(null);
  const measured = useRef<MenuLevel>(undefined);
  const [layout, setLayout] = useState<{ level: MenuLevel; placement: MenuPlacement }>();
  const [focused, setFocused] = useState<number>();

  useLayoutEffect(() => {
    const popup = ref.current;
    if (popup === null) {
      return undefined;
    }

    return controller.attachPanel(level, popup);
  }, [controller, level]);

  useLayoutEffect(() => {
    const popup = ref.current;
    if (!parentPlaced || popup === null || measured.current === level) {
      return;
    }

    // Enter the top layer once per opening, including Strict Mode replays. Measure children after their parent is placed.
    if (measured.current === undefined) {
      popup.showPopover?.();
    }

    measured.current = level;
    const viewport = popup.ownerDocument.documentElement;
    const position = positionOf(level, mode, popup);
    const size = popup.getBoundingClientRect();
    // Keep an already-capped body scrolled. Its clipped content still counts toward the natural height used to place it.
    const body = popup.style.getPropertyValue('--_max-height') === '' ? null : popup.firstElementChild;
    const natural = body === null ? size : { width: size.width, height: size.height + Math.max(0, body.scrollHeight - body.clientHeight) };
    setLayout({ level, placement: placeMenu(position, natural, {
      width: viewport.clientWidth, height: viewport.clientHeight,
    }, rtl) });
  }, [level, mode, parentPlaced, rtl]);

  useLayoutEffect(() => {
    const popup = ref.current;
    if (layout?.level === level && popup !== null) {
      describeClippedRows(popup, level);
      controller.panelReady(level);
      if (level.focus === 'none') {
        const active = popup.ownerDocument.activeElement;
        setFocused(popup.contains(active) ? rowAt(level, active)?.index : undefined);
      }
    }
  }, [controller, layout, level]);

  const expanded = child?.position.kind === 'branch' ? { index: child.position.parentIndex, id: child.id } : undefined;
  const active = focused ?? expanded?.index;
  const { model } = level;
  const placement = layout?.placement;

  const panel = (
    <div
      ref={ref}
      id={level.id}
      role="menu"
      aria-label={level.label}
      dir={rtl ? 'rtl' : 'ltr'}
      tabIndex={-1}
      popover={typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function' ? 'manual' : undefined}
      className={styles.root}
      data-ov-menu-popup=""
      data-ov-menu-owner={ownerId}
      data-ov-menu-profile={mode}
      data-ov-side={placement?.side}
      style={{
        '--_x': placement === undefined ? undefined : `${placement.left}px`,
        '--_y': placement === undefined ? undefined : `${placement.top}px`,
        '--_max-width': placement === undefined ? undefined : `${placement.maxWidth}px`,
        '--_max-height': placement?.maxHeight === undefined ? undefined : `${placement.maxHeight}px`,
      }}
      onFocus={(event) => {
        setFocused(rowAt(level, event.target)?.index);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocused(undefined);
        }

        if (event.relatedTarget === null) {
          controller.panelBlur(level);
        }
      }}
      onClick={(event) => {
        if (event.defaultPrevented) {
          return;
        }

        const row = rowAt(level, event.target);
        if (row !== undefined) {
          controller.select(level, row);
        }
      }}
      onKeyDown={(event) => {
        if (controller.keyDown(level, event.nativeEvent)) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onPointerMove={(event) => {
        if (event.pointerType !== 'touch') {
          controller.pointerMove(level, rowAt(level, event.target));
        }
      }}
      onPointerLeave={() => {
        controller.pointerLeave(level);
      }}
      onMouseDown={(event) => {
        // A press on padding or a separator must not take focus out of the tree.
        if (event.button === 0) {
          event.preventDefault();
        }
      }}
    >
      <div
        className={styles.body}
        data-ov-menu-body=""
        data-ov-mark={model.mark ? '' : undefined}
        data-ov-icon={model.icon ? '' : undefined}
        data-ov-arrow={model.arrow ? '' : undefined}
        data-ov-metadata-icon={model.metadataIcon ? '' : undefined}
      >
        <MenuRows nodes={model.nodes} expanded={expanded} />
      </div>
      {model.hinted.length === 0 ? null : (
        <div className={styles.footer} data-ov-menu-footer="" aria-hidden="true">
          <span className={styles.hintSizes}>{model.hinted.map((row) => <Hints key={row.index} hints={row.entry.hints} />)}</span>
          <span className={styles.hintLine}><Hints hints={active === undefined ? undefined : model.rows[active]?.entry.hints} /></span>
        </div>
      )}
    </div>
  );
  return <>
    {panel}
    {child === undefined ? null : (
      <MenuPanel key={child.epoch} controller={controller} level={child} view={view} parentPlaced={parentPlaced && layout?.level === level} />
    )}
  </>;
}
