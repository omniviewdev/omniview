import { place } from './placement';
import { CLIP_ATTRIBUTE, FULL_ATTRIBUTE, TIP_ATTRIBUTE, TIP_DELAY_ATTRIBUTE } from './tip';

/**
 * The delegated tooltip: ONE set of listeners on the document and the window serves every trigger in the application, however many
 * are mounted, drawn in ONE popover element. Nothing binds per trigger, so 1,000 rows cost nothing here; a trigger is any element
 * with `data-ov-tip`, or a clipping element (`data-ov-clip`) while its text is cut. This is the mock's disclosure layer for the tooltip
 * (core.js, `disclosure`), kept in what it does and rewritten as plain functions over one small state:
 *
 *   open     500 ms after the pointer reaches a trigger (`data-ov-tip-delay="0"`: at once); at once on keyboard `:focus-visible`
 *   persist  while the trigger is focused, or the trigger or the tooltip is hovered; the stylesheet bridges the gap between them
 *   close    Escape, a press or click of the trigger, a scroll that MOVES the trigger (see below), a resize, the window losing focus,
 *            the trigger leaving the page or changing what it says, or opening a popup of its own
 *   Escape   hides the tip and goes on: it is never prevented or stopped, so a dialog whose Close shows its tip closes on that same
 *            press (the mock, finding PB-13). The same hover or focus does not bring the tip back; leaving it does
 *   sets     the trigger is described by the tip while it is open, unless its own name already is the text
 *
 * Scrolling. A tip describes the trigger the pointer is on, so a scroll ends it when that trigger is no longer where the pointer reached it: its
 * rectangle changed (which is what a trigger scrolled out of the window does too). The mock closes a tip on ANY scroll of anything that holds its
 * trigger (core.js 3529-3535), and a list that follows a live stream scrolls on every frame that draws a line, whether or not the trigger moved, so there
 * a tip never opened (L2-03). Here a scroll that leaves the trigger where it was (a head that sticks, a control that is fixed) leaves the tip alone, and
 * a waiting delay goes on. A row that scrolls under a resting pointer is not the trigger the pointer reached: its tip ends, and the row now under the
 * pointer is a new trigger that gets its own tip after the usual delay, once the engine says the pointer is over it (`pointerover` after each step in
 * Chromium, after the scrolling has settled in WebKit). So a list that moves its rows under the pointer faster than the delay shows no tip, and none
 * ever points at a row that is gone. While no tip is shown or waiting a scroll costs nothing; while one is, a scroll of something that holds its
 * trigger costs one rectangle read.
 */

/** The design's hover delay: the tip opens 500 ms after the pointer reaches a trigger (design 12, 15). */
export const DELAY_MS = 500;

/** A pixel is the rounding of a layout, not a move (as `isCut` allows a pixel of text): a trigger this near its place has not moved. */
const MOVED_PX = 1;

const TRIGGER = `[${TIP_ATTRIBUTE}], [${CLIP_ATTRIBUTE}]`;
const WATCHED = [TIP_ATTRIBUTE, FULL_ATTRIBUTE, CLIP_ATTRIBUTE, 'inert', 'aria-expanded', 'popovertarget'];

/** A host is attached once per document: a second one would be a second popup, which is what this exists to prevent. */
const attached = new WeakSet<Document>();

type Described = { readonly text: string; readonly clip: boolean };
/** Where a trigger is, in the window: what `getBoundingClientRect` says. */
type Where = Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom' | 'width' | 'height'>;

/** Whether a trigger is somewhere other than `was`, by more than the rounding of a layout. */
function moved(was: Where, now: Where): boolean {
  return Math.abs(now.left - was.left) > MOVED_PX || Math.abs(now.top - was.top) > MOVED_PX || Math.abs(now.width - was.width) > MOVED_PX || Math.abs(now.height - was.height) > MOVED_PX;
}

/** `matches()` that answers false for a selector the engine does not know (`:popover-open`, `:focus-visible` in an old one). */
function matches(element: Element, selector: string): boolean {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

/** The text a clipping element names: its full text, else what it shows, with white space collapsed. */
function clipText(element: Element): string {
  const named = element.getAttribute(FULL_ATTRIBUTE)?.trim();
  if (named !== undefined && named !== '') {
    return named;
  }

  const shown = element instanceof HTMLElement && typeof element.innerText === 'string' ? element.innerText : (element.textContent ?? '');
  return shown.replace(/\s+/g, ' ').trim();
}

/**
 * Whether the text of an element is cut: it clips its overflow and its content is wider or taller than its box by more than the pixel a
 * layout rounds. A line of text is cut in width; a block clamped to some lines wraps, so it is never wider than its box and is cut in height
 * (the mock's `clipped()` measures `data-clamp` boxes by height too). Measured when the pointer or focus arrives, never in advance, so no row
 * carries an observer. Overflow that is visible paints outside the box and cuts nothing.
 */
function isCut(element: Element): boolean {
  const style = getComputedStyle(element);
  const overflow = style.overflowX === '' ? style.overflow : style.overflowX;
  return /hidden|clip|scroll|auto/.test(overflow) && (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1);
}

/** What a trigger says, before asking whether it is cut: its own tip wins, else the full text of a clipping element. */
function candidate(element: Element): Described | null {
  const own = element.getAttribute(TIP_ATTRIBUTE);
  if (own !== null && own.trim() !== '') {
    return { text: own, clip: false };
  }

  if (!element.hasAttribute(CLIP_ATTRIBUTE)) {
    return null;
  }

  const text = clipText(element);
  return text === '' ? null : { text, clip: true };
}

const isUnavailable = (element: Element) => element.getAttribute('aria-disabled') === 'true';

function holdsPopup(element: Element): boolean {
  if (element.getAttribute('aria-expanded') === 'true') {
    return true;
  }

  const target = element.getAttribute('popovertarget');
  const popup = target === null ? null : element.ownerDocument.getElementById(target);
  return popup !== null && matches(popup, ':popover-open');
}

/**
 * Installs the tooltip on `host`, a connected element with the `popover` attribute, and returns the function that removes it.
 * @throws when the document already has a host, or the engine has no Popover API.
 */
export function attachTooltips(host: HTMLElement): () => void {
  const doc = host.ownerDocument;
  const win = doc.defaultView;
  if (win === null) {
    throw new Error('TooltipHost needs a window: its document has none.');
  }

  if (attached.has(doc)) {
    throw new Error('Mount one TooltipHost per window: another is already attached to this document.');
  }

  if (typeof host.showPopover !== 'function') {
    throw new Error('TooltipHost needs the Popover API, which this engine does not have.');
  }

  attached.add(doc);
  // The text sits in one inner element, so that the host never clips what it holds: the stylesheet's bridge to the trigger lies outside the
  // host's padding box, and a scrolling host would cut it. When the tip is limited in height, this element scrolls (TooltipHost.module.css).
  const body = doc.createElement('div');
  body.setAttribute('data-ov-tip-body', '');
  host.append(body);

  let shown: Element | null = null;
  let shownText = '';
  let pending: Element | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** The trigger whose tip was dismissed (Escape, a press): it stays quiet until pointer and focus have left it. */
  let dismissed: Element | null = null;
  let open = false;
  let observer: MutationObserver | undefined;
  /** Where the trigger of the shown or waiting tip was when the pointer reached it, or when it took focus: a scroll that leaves it there leaves the tip alone. */
  let reached: Where | null = null;

  const ids = (element: Element) => (element.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
  const describe = (element: Element) => {
    const list = ids(element);
    if (!list.includes(host.id)) {
      element.setAttribute('aria-describedby', [...list, host.id].join(' '));
    }
  };

  const undescribe = (element: Element) => {
    const list = ids(element).filter((id) => id !== host.id);
    if (list.length > 0) {
      element.setAttribute('aria-describedby', list.join(' '));
    } else {
      element.removeAttribute('aria-describedby');
    }
  };

  /** A trigger worth a tip now: on the page, not behind an inert region, not holding a popup of its own, with something to say. */
  const valid = (element: Element, measure: boolean): Described | null => {
    if (!element.isConnected || element.closest('[inert]') !== null || holdsPopup(element)) {
      return null;
    }

    const said = candidate(element);
    return said !== null && (!said.clip || !measure || isCut(element)) ? said : null;
  };

  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    pending = null;
  };

  /** Something changed that a shown or waiting tip depends on: end it, and say nothing. */
  const check = () => {
    if (pending !== null && valid(pending, false) === null) {
      cancel();
    }

    if (shown !== null && valid(shown, false)?.text !== shownText) {
      hide();
    }

    if (shown === null && pending === null) {
      observer?.disconnect();
    }
  };

  const watch = () => {
    observer ??= new MutationObserver(check);
    // `characterData`: a label edited in place (`text.data = …`) is not a child list change.
    observer.observe(doc.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: WATCHED });
  };

  function hide(dismiss = false) {
    const owner = shown;
    const waiting = pending;
    cancel();
    if (dismiss && (owner ?? waiting) !== null) {
      dismissed = owner ?? waiting;
    }

    shown = null;
    reached = null;
    if (owner !== null) {
      undescribe(owner);
    }

    if (open) {
      open = false;
      if (host.isConnected) {
        host.hidePopover();
      }
    }

    observer?.disconnect();
  }

  /** Below, above, right or left of the trigger; the host measures itself first, so the text is already in. */
  function position(box: Where) {
    host.style.maxHeight = '';
    host.style.left = '0px';
    host.style.top = '0px';
    const where = place(box, { width: host.offsetWidth, height: host.offsetHeight }, { width: doc.documentElement.clientWidth, height: doc.documentElement.clientHeight });
    host.style.left = `${where.left}px`;
    host.style.top = `${where.top}px`;
    host.setAttribute('data-placement', where.side);
    if (where.maxHeight === undefined) {
      host.removeAttribute('data-ov-clamped');
    } else {
      host.style.maxHeight = `${where.maxHeight}px`;
      host.setAttribute('data-ov-clamped', 'true');
    }
  }

  function show(owner: Element) {
    // Where the trigger was when the pointer reached it, if this tip waited for its delay: a trigger that has moved since is not under the pointer, and nothing is shown for it.
    const arrived = pending === owner ? reached : null;
    cancel();
    if (owner === shown || owner === dismissed) {
      return;
    }

    const said = valid(owner, true);
    if (said === null) {
      return;
    }

    const box = owner.getBoundingClientRect();
    if (arrived !== null && moved(arrived, box)) {
      return;
    }

    hide();
    body.textContent = said.text;
    host.showPopover();
    open = true;
    shown = owner;
    shownText = said.text;
    // A trigger whose name already is the text needs no second description; a clipping element holds the text as its own content.
    if (!said.clip && owner.getAttribute('aria-label')?.trim() !== said.text.trim()) {
      describe(owner);
    }

    reached = box;
    position(box);
    watch();
  }

  function schedule(owner: Element) {
    if (owner === shown || owner === pending) {
      return;
    }

    cancel();
    hide();
    if (owner === dismissed || valid(owner, true) === null) {
      return;
    }

    const delay = owner.getAttribute(TIP_DELAY_ATTRIBUTE) === '0' ? 0 : DELAY_MS;
    if (delay === 0) {
      show(owner);
      return;
    }

    pending = owner;
    reached = owner.getBoundingClientRect();
    timer = setTimeout(() => {
      show(owner);
    }, delay);
    watch();
  }

  const elementOf = (event: Event) => (event.target instanceof Element ? event.target : null);
  const nodeOf = (target: EventTarget | null) => (target instanceof Node ? target : null);

  const onPointerOver = (event: PointerEvent) => {
    const target = elementOf(event);
    if (event.pointerType === 'touch' || target === null || host.contains(target)) {
      return;
    }

    const owner = target.closest(TRIGGER);
    if (owner !== null) {
      schedule(owner);
    }
  };

  const onPointerOut = (event: PointerEvent) => {
    const target = elementOf(event);
    if (target === null) {
      return;
    }

    const next = nodeOf(event.relatedTarget);
    if (host.contains(target)) {
      if (next !== null && (host.contains(next) || shown?.contains(next) === true)) {
        return;
      }

      if (shown !== null && !matches(shown, ':focus-visible')) {
        hide();
      }

      return;
    }

    const owner = target.closest(TRIGGER);
    if (owner === null || (next !== null && (owner.contains(next) || (owner === shown && host.contains(next))))) {
      return;
    }

    if (pending === owner) {
      cancel();
    }

    if (dismissed === owner && !matches(owner, ':focus-visible')) {
      dismissed = null;
    }

    if (shown === owner && !matches(owner, ':focus-visible')) {
      hide();
    }
  };

  const onFocusIn = (event: FocusEvent) => {
    const target = elementOf(event);
    if (target === null || !matches(target, ':focus-visible')) {
      return;
    }

    // Native popover dismissal can hand focus back before its own top-layer work is done: look again once it has settled.
    queueMicrotask(() => {
      if (doc.activeElement !== target || !matches(target, ':focus-visible')) {
        return;
      }

      const owner = target.closest(TRIGGER);
      if (owner !== null) {
        show(owner);
      }
    });
  };

  const onFocusOut = (event: FocusEvent) => {
    const target = elementOf(event);
    const owner = target?.closest(TRIGGER) ?? null;
    const next = nodeOf(event.relatedTarget);
    if (owner === null || (next !== null && owner.contains(next))) {
      return;
    }

    if (dismissed === owner && !matches(owner, ':hover')) {
      dismissed = null;
    }

    if (shown === owner && !matches(owner, ':hover') && !matches(host, ':hover')) {
      hide();
    }
  };

  /** A press or a key activation of the trigger ends its tip for the episode, except on a control that is unavailable: its press does nothing, so the reason stays. */
  const onPointerDown = (event: PointerEvent) => {
    const active = shown ?? pending;
    const target = elementOf(event);
    if (active === null || (target !== null && host.contains(target))) {
      return;
    }

    const inside = target !== null && active.contains(target);
    if (!(inside && isUnavailable(active))) {
      hide(inside);
    }
  };

  const onClick = (event: MouseEvent) => {
    const target = elementOf(event);
    if (shown !== null && target !== null && shown.contains(target) && !isUnavailable(shown)) {
      hide(true);
    }
  };

  /**
   * Escape hides the tip and nothing more: the event is neither prevented nor stopped, so the layer behind it (a dialog, a menu) gets
   * the same press. Safari reports the Escape that ends an input-method composition as keyCode 229 with isComposing already false.
   */
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.keyCode === 229) {
      return;
    }

    if (shown !== null || pending !== null) {
      hide(true);
    }
  };

  /**
   * A scroll ends the tip of a trigger it moved. With no tip shown or waiting it does nothing at all, however often it comes (a list that follows a stream scrolls on every frame); with one, a scroll of
   * something that holds the trigger reads its rectangle once, and the tip ends when that is not where the pointer reached it.
   */
  const onScroll = (event: Event) => {
    const active = shown ?? pending;
    if (active === null || reached === null) {
      return;
    }

    const holds = event.target === doc || (event.target instanceof Element && event.target.contains(active));
    if (holds && moved(reached, active.getBoundingClientRect())) {
      hide();
    }
  };

  const onWindowChange = () => {
    hide();
  };

  doc.addEventListener('pointerover', onPointerOver);
  doc.addEventListener('pointerout', onPointerOut);
  doc.addEventListener('focusin', onFocusIn);
  doc.addEventListener('focusout', onFocusOut);
  doc.addEventListener('pointerdown', onPointerDown, true);
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('scroll', onScroll, true);
  win.addEventListener('keydown', onKeyDown, true);
  win.addEventListener('resize', onWindowChange);
  win.addEventListener('blur', onWindowChange);

  return () => {
    hide();
    observer?.disconnect();
    doc.removeEventListener('pointerover', onPointerOver);
    doc.removeEventListener('pointerout', onPointerOut);
    doc.removeEventListener('focusin', onFocusIn);
    doc.removeEventListener('focusout', onFocusOut);
    doc.removeEventListener('pointerdown', onPointerDown, true);
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('scroll', onScroll, true);
    win.removeEventListener('keydown', onKeyDown, true);
    win.removeEventListener('resize', onWindowChange);
    win.removeEventListener('blur', onWindowChange);
    body.remove();
    attached.delete(doc);
  };
}
