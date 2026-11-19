import { CARD_ANCHOR_ATTRIBUTE, CARD_ARROW_ATTRIBUTE, CARD_ATTRIBUTE } from './card';
import { place } from './placement';

/**
 * The delegated hover card: ONE set of listeners on the document and the window serves every trigger in the application, however many are
 * mounted, and ONE popover element shows the card of whichever trigger is current. Nothing binds per trigger. A trigger is any element with
 * `data-ov-card`; its value is the key the host's `render` answers with content. This is the mock's session card (shell-panel.js, "Session
 * cards"; design 16 SCD1) kept in what it does and rewritten as plain functions over one small state, so it runs without React:
 *
 *   open     500 ms after the pointer reaches a trigger, and 500 ms after keyboard `:focus-visible`; at once when another card is already
 *            showing (the card of the next trigger replaces it: no second wait); the Down arrow on a trigger that asks for it (`data-ov-card-arrow`)
 *            opens the card at once and enters it. A trigger that is detached, inert, inside an open `dialog`, or whose key has no card never opens
 *   persist  while the trigger is `:focus-visible` or focus is inside the card, or either is hovered; leaving both closes the card after a 120 ms
 *            grace, so that crossing the 8 px gap to the card, or from one trigger to the next, does not flicker (the stylesheet bridges the gap)
 *   close    Escape; a press outside the card; a click on a link or button in it; a scroll of anything that holds the trigger; a resize; the window
 *            losing focus; the trigger leaving the page, going inert or changing its key; a dialog opening; the host having no card for the key now
 *   Escape   closes the card and goes no further (it is prevented and stopped) only when a card was open: the layer behind it must not close with
 *            it. The same hover or focus does not bring the card back; leaving the trigger with both pointer and focus does (WCAG 1.4.13: dismissible)
 *   never    takes the focus when it opens: only the Down arrow, which asks for it, moves the focus in. Tab, Shift+Tab and the arrows then walk its
 *            controls and wrap; Escape closes the card and returns the focus to the trigger (WCAG 1.4.13: hoverable, persistent)
 *
 * React draws the content: the controller keeps the state (which key is open, against which anchor) as a tiny external store, and the host calls
 * `settle()` after each commit, so that the popover is shown, measured and placed only once its content is in.
 */

/** The design's hover delay: the card opens 500 ms after the pointer reaches a trigger (design 12, 15). */
export const OPEN_DELAY_MS = 500;
/** The grace after the pointer leaves the trigger and the card, so that crossing the gap between them does not close it. */
export const GRACE_MS = 120;

const TRIGGER = `[${CARD_ATTRIBUTE}]`;
const ANCHOR = `[${CARD_ANCHOR_ATTRIBUTE}]`;
/** What the keyboard walks inside a card (a native `disabled` button cannot take focus: the kit's own never use it). */
const CONTROLS = 'a[href], button:not([disabled])';
const WATCHED = [CARD_ATTRIBUTE, CARD_ANCHOR_ATTRIBUTE, 'inert', 'open'];

/** A host is attached once per document: a second one would be a second popup, which is what this exists to prevent. */
const attached = new WeakSet<Document>();

/** How a card came: the pointer rested on its trigger, the trigger took keyboard focus, or the Down arrow asked for it (and enters the card). */
export type CardEntry = 'pointer' | 'focus' | 'arrow';

const RANK: Readonly<Record<CardEntry, number>> = { pointer: 0, focus: 1, arrow: 2 };

/** The card that is open, or `null`. The object is replaced whenever any of it changes, so it is a snapshot a store can compare. */
export type CardState = {
  /** The trigger's `data-ov-card`: what the host's `render` answers. */
  readonly key: string;
  readonly trigger: Element;
  /** The element the card is placed against: the nearest ancestor-or-self of the trigger with `data-ov-card-anchor`, else the trigger. */
  readonly anchor: Element;
  readonly entry: CardEntry;
} | null;

export type HoverCards = {
  readonly subscribe: (listener: () => void) => () => void;
  /** The card that is open now. Stable between changes. */
  readonly getSnapshot: () => CardState;
  /** How to find out whether a key has a card now; asked when a card is about to open. Until it is set, no key has one. */
  readonly setAvailability: (has: (key: string) => boolean) => void;
  /**
   * Installs the listeners on the document of `host` (a connected element with the `popover` attribute) and says where the live region is.
   * Returns the function that removes them and closes the card.
   * @throws when the document already has a host, or the engine has no Popover API.
   */
  readonly attach: (host: HTMLElement, region: HTMLElement) => () => void;
  /**
   * The content of the card in the snapshot is in the DOM: show the popover, measure it and place it; enter the card when the Down arrow asked;
   * say `announce` when keyboard focus opened a card that has controls. Safe to call after every commit: it only does what is still to do.
   */
  readonly settle: (announce: string | undefined) => void;
  /** Closes the card, if one is open. */
  readonly close: () => void;
};

/** `matches()` that answers false for a selector the engine does not know (`:focus-visible` in an old one). */
function matches(element: Element, selector: string): boolean {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

const elementOf = (event: Event): Element | null => (event.target instanceof Element ? event.target : null);
const nodeOf = (target: EventTarget | null): Node | null => (target instanceof Node ? target : null);

function keyOf(trigger: Element): string | null {
  const key = trigger.getAttribute(CARD_ATTRIBUTE);
  return key === null || key.trim() === '' ? null : key;
}

export function createHoverCards(): HoverCards {
  let state: CardState = null;
  let has: (key: string) => boolean = () => false;
  let bound: { readonly settle: HoverCards['settle']; readonly close: HoverCards['close'] } | null = null;
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of [...listeners]) {
      listener();
    }
  };

  const attach: HoverCards['attach'] = (host, region) => {
    const doc = host.ownerDocument;
    const win = doc.defaultView;
    if (win === null) {
      throw new Error('HoverCardHost needs a window: its document has none.');
    }

    if (attached.has(doc)) {
      throw new Error('Mount one HoverCardHost per window: another is already attached to this document.');
    }

    if (typeof host.showPopover !== 'function') {
      throw new Error('HoverCardHost needs the Popover API, which this engine does not have.');
    }

    attached.add(doc);

    /** The trigger whose pointer or focus is waiting for the delay. */
    let pending: Element | null = null;
    let pendingEntry: CardEntry = 'pointer';
    let timer: ReturnType<typeof setTimeout> | undefined;
    let grace: ReturnType<typeof setTimeout> | undefined;
    let release: ReturnType<typeof setTimeout> | undefined;
    /** The trigger whose card was dismissed (Escape, a press): it stays quiet until pointer and focus have left it. */
    let dismissed: Element | null = null;
    /** The popover is in the top layer. */
    let shown = false;
    /** The Down arrow's request to enter the card has been served; the announcement has been said. Both are once per card. */
    let entered = false;
    let announced = false;
    let observer: MutationObserver | undefined;
    let resize: ResizeObserver | undefined;
    /**
     * The control that holds the focus in a trigger while the focus is outside the card: where the focus goes back to when the card took it and ends. A trigger that wraps its link or button cannot
     * take the focus itself, so it is that control and not the trigger.
     */
    let returnTo: HTMLElement | null = null;

    const controls = (): HTMLElement[] => Array.from(host.querySelectorAll<HTMLElement>(CONTROLS));

    /** Whether the keyboard holds a trigger: it, or a control inside it (a trigger may wrap its link or button), is the focused element and matches :focus-visible. */
    const keyboardHolds = (trigger: Element): boolean => {
      const active = doc.activeElement;
      return active !== null && trigger.contains(active) && matches(active, ':focus-visible');
    };

    /**
     * Moves the focus onto a control of the card without moving the page, then scrolls the card's body only as far as the control needs to be
     * seen: a card that is clamped to the room there is scrolls its body (the host's one child), and `preventScroll` leaves a control below or
     * above its scrollport clipped. The one way focus moves inside the card, so that the Down arrow and the walking keys cannot differ.
     */
    const focusOn = (control: HTMLElement) => {
      control.focus({ preventScroll: true });
      const body = host.firstElementChild;
      if (host.getAttribute('data-ov-clamped') !== 'true' || !(body instanceof HTMLElement) || !body.contains(control)) {
        return;
      }

      const view = body.getBoundingClientRect();
      const box = control.getBoundingClientRect();
      if (box.top < view.top) {
        body.scrollTop -= view.top - box.top;
      } else if (box.bottom > view.bottom) {
        body.scrollTop += box.bottom - view.bottom;
      }
    };

    const focusControl = (index: number): boolean => {
      const list = controls();
      const control = list[Math.min(Math.max(index, 0), list.length - 1)];
      if (control !== undefined) {
        focusOn(control);
      }

      return list.length > 0;
    };

    /** A trigger a card may open for now: on the page, not behind an inert region, and no dialog open over the page. */
    const allowed = (trigger: Element): boolean =>
      trigger.isConnected && trigger.closest('[inert]') === null && doc.querySelector('dialog[open]') === null;

    /** Forgets the card that waits for its delay. The page is watched only while a card is open or waits, so nothing waits: it is not watched. */
    const cancel = () => {
      clearTimeout(timer);
      timer = undefined;
      pending = null;
      if (state === null) {
        observer?.disconnect();
      }
    };

    const clearGrace = () => {
      clearTimeout(grace);
      grace = undefined;
    };

    /** Something changed that an open or waiting card depends on: end it, and say nothing. */
    const check = () => {
      if (pending !== null && !(allowed(pending) && keyOf(pending) !== null)) {
        cancel();
      }

      if (state !== null && !(allowed(state.trigger) && keyOf(state.trigger) === state.key)) {
        end();
      }
    };

    const watch = () => {
      observer ??= new MutationObserver(check);
      observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: WATCHED });
    };

    /**
     * Ends the card that is open or waiting. `dismiss` keeps it from coming back for the same hover or focus. Focus that is in the card at that moment goes back to the trigger, or to the
     * control inside it that held the focus when the trigger wraps its link or button; focus that the card's own action moved elsewhere stays where it is.
     */
    function end(dismiss = false) {
      const owner = state?.trigger ?? null;
      const waiting = pending;
      const inside = host.contains(doc.activeElement);
      clearGrace();
      clearTimeout(release);
      release = undefined;
      cancel();
      if (dismiss && (owner ?? waiting) !== null) {
        dismissed = owner ?? waiting;
      }

      const had = state !== null;
      state = null;
      entered = false;
      announced = false;
      region.textContent = '';
      if (shown) {
        shown = false;
        if (host.isConnected) {
          host.hidePopover();
        }
      }

      host.style.left = '';
      host.style.top = '';
      host.style.maxHeight = '';
      host.removeAttribute('data-placement');
      host.removeAttribute('data-ov-clamped');
      resize?.disconnect();
      observer?.disconnect();
      if (inside && owner instanceof HTMLElement && owner.isConnected) {
        // A trigger that wraps its link or button cannot take the focus itself: the control inside it that held the focus before the card took it does.
        const back = returnTo !== null && returnTo.isConnected && owner.contains(returnTo) ? returnTo : owner;
        back.focus({ preventScroll: true });
        // The focus handler may queue the card again for this trigger: ending a card is not a request for another one.
        cancel();
      }

      if (had) {
        notify();
      }
    }

    /** Below the anchor, else above it; the host measures itself first, so its content is already in. */
    function position(anchor: Element) {
      host.style.maxHeight = '';
      host.style.left = '0px';
      host.style.top = '0px';
      const where = place(
        anchor.getBoundingClientRect(),
        { width: host.offsetWidth, height: host.offsetHeight },
        { width: doc.documentElement.clientWidth, height: doc.documentElement.clientHeight },
      );
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

    const settle: HoverCards['settle'] = (announce) => {
      const card = state;
      if (card === null) {
        return;
      }

      if (!shown) {
        host.showPopover();
        shown = true;
        // The content of a card changes by itself (what it subscribes to): when its size does, it is placed again.
        if (typeof ResizeObserver === 'function') {
          resize ??= new ResizeObserver(() => {
            if (state !== null && shown) {
              position(state.anchor);
            }
          });
          resize.observe(host);
        }
      }

      position(card.anchor);
      if (card.entry === 'arrow' && !entered) {
        entered = true;
        focusControl(0);
      }

      if (card.entry === 'focus' && !announced && announce !== undefined && announce.trim() !== '' && controls().length > 0) {
        announced = true;
        region.textContent = announce;
      }
    };

    /** Opens the card of `owner` now, or says that it cannot be: there is none for its key, or it is not allowed or was dismissed. */
    function open(owner: Element, entry: CardEntry): boolean {
      cancel();
      const key = keyOf(owner);
      if (key === null || !allowed(owner) || (owner === dismissed && entry !== 'arrow') || !has(key)) {
        return false;
      }

      // The Down arrow is a request: it brings back a card that was dismissed.
      if (owner === dismissed) {
        dismissed = null;
      }

      clearGrace();
      const card = state;
      if (card !== null && card.trigger === owner && card.key === key) {
        // The card is already showing: a keyboard arrival after a pointer one is how it is announced, and the arrow is how it is entered.
        if (RANK[entry] > RANK[card.entry]) {
          state = { ...card, entry };
          notify();
        }

        return true;
      }

      // Ending the old card cancels what handing its focus back to the trigger queued (it cancels itself): the card opened now is the only one.
      end();
      state = { key, trigger: owner, anchor: owner.closest(ANCHOR) ?? owner, entry };
      watch();
      notify();
      return true;
    }

    /** A card that is already showing is replaced at once by the card of the next trigger (no second wait); otherwise the standard delay. */
    function schedule(owner: Element, entry: 'pointer' | 'focus') {
      const showing = state?.trigger ?? null;
      if (owner === showing || owner === pending) {
        clearGrace();
        if (entry === 'focus') {
          if (owner === showing) {
            open(owner, 'focus');
          } else {
            pendingEntry = 'focus';
          }
        }

        return;
      }

      if (owner === dismissed || !allowed(owner)) {
        return;
      }

      if (showing !== null) {
        open(owner, entry);
        return;
      }

      cancel();
      pending = owner;
      pendingEntry = entry;
      timer = setTimeout(() => {
        if (pending === owner) {
          open(owner, pendingEntry);
        }
      }, OPEN_DELAY_MS);
      watch();
    }

    /** Leaving the trigger and the card closes the card after a short grace; a card that the keyboard holds, or the pointer is on, stays. */
    function leave() {
      // The wait of a trigger that the keyboard holds goes on (no other focus event will start it again); the wait of a pointer that merely leaves is given up.
      if (pending !== null && state === null && !keyboardHolds(pending)) {
        cancel();
      }

      if (state === null) {
        return;
      }

      clearGrace();
      grace = setTimeout(() => {
        grace = undefined;
        const trigger = state?.trigger;
        if (trigger === undefined) {
          return;
        }

        // A trigger that wraps its link or button is held by the focus of that descendant: only the focused element matches :focus-visible.
        const held = keyboardHolds(trigger) || host.contains(doc.activeElement);
        const over = matches(trigger, ':hover') || matches(host, ':hover');
        if (!held && !over) {
          end();
        }
      }, GRACE_MS);
    }

    const onPointerOver = (event: PointerEvent) => {
      const target = elementOf(event);
      if (event.pointerType === 'touch' || target === null) {
        return;
      }

      if (host.contains(target)) {
        clearGrace();
        return;
      }

      const owner = target.closest(TRIGGER);
      if (owner !== null) {
        schedule(owner, 'pointer');
      }
    };

    const onPointerOut = (event: PointerEvent) => {
      const target = elementOf(event);
      if (target === null) {
        return;
      }

      const next = nodeOf(event.relatedTarget);
      const owner = target.closest(TRIGGER);
      // A dismissed trigger stays so while the keyboard still holds it, itself or a control inside it.
      if (owner !== null && dismissed === owner && !(next !== null && owner.contains(next)) && !keyboardHolds(owner)) {
        dismissed = null;
      }

      const leavesTrigger = owner !== null && !(next !== null && (owner.contains(next) || host.contains(next)));
      const leavesCard = host.contains(target) && !(next !== null && (host.contains(next) || state?.trigger.contains(next) === true));
      if (leavesTrigger || leavesCard) {
        leave();
      }
    };

    const onFocusIn = (event: FocusEvent) => {
      const target = elementOf(event);
      if (target === null) {
        return;
      }

      const owner = target.closest(TRIGGER);
      // The control that holds the focus in a trigger is where the focus goes back to when the card has taken it: focus in the card leaves that as it was, focus anywhere else forgets it.
      if (!host.contains(target)) {
        returnTo = owner !== null && target instanceof HTMLElement ? target : null;
      }

      if (owner !== null && matches(target, ':focus-visible')) {
        schedule(owner, 'focus');
        return;
      }

      // Focus went to something that is neither the card nor its trigger: the card has nothing to do with it.
      const showing = state?.trigger ?? null;
      if (showing !== null && !host.contains(target) && !showing.contains(target)) {
        end();
      }
    };

    const onFocusOut = (event: FocusEvent) => {
      const target = elementOf(event);
      const next = nodeOf(event.relatedTarget);
      // Focus that leaves for anything but the card leaves the trigger's control behind (the control the focus arrives in, if it is in a trigger, is remembered by its own focusin).
      if (next === null || !host.contains(next)) {
        returnTo = null;
      }

      const out = target?.closest(TRIGGER) ?? null;
      const stays = out !== null && next !== null && out.contains(next);
      if (out !== null && !stays && !matches(out, ':hover')) {
        if (out === dismissed) {
          dismissed = null;
        }

        if (out === pending && state === null) {
          cancel();
        }
      }

      const showing = state?.trigger ?? null;
      if (showing === null || (next !== null && (showing.contains(next) || host.contains(next)))) {
        return;
      }

      if (!matches(showing, ':hover') && !matches(host, ':hover')) {
        end();
      }
    };

    /** A press anywhere but the card ends it; a press on the trigger ends it for the episode too: the user acts, the card steps aside. */
    const onPointerDown = (event: PointerEvent) => {
      const active = state?.trigger ?? pending;
      const target = elementOf(event);
      if (active === null || (target !== null && host.contains(target))) {
        return;
      }

      end(target !== null && active.contains(target));
    };

    /** A control of the card was used: the card has done its work. It closes once the click has been handled. */
    const onClick = (event: MouseEvent) => {
      const target = elementOf(event);
      if (state !== null && target !== null && host.contains(target) && target.closest(CONTROLS) !== null) {
        clearTimeout(release);
        release = setTimeout(() => {
          release = undefined;
          end();
        }, 0);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const target = elementOf(event);
      // Safari reports the Escape that ends an input-method composition as keyCode 229 with isComposing already false.
      if (target === null || event.isComposing || event.keyCode === 229) {
        return;
      }

      if (event.key === 'Escape' && (state !== null || pending !== null)) {
        // Only an open card consumes the press: the layer behind it (a dialog, a menu) must not close with it.
        if (state !== null) {
          event.preventDefault();
          event.stopPropagation();
        }

        end(true);
        return;
      }

      const bare = !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
      if (!host.contains(target)) {
        // The Down arrow on a trigger that asks for it: the way into the card from the keyboard.
        if (event.key === 'ArrowDown' && bare && matches(target, TRIGGER) && target.getAttribute(CARD_ARROW_ATTRIBUTE) === 'down') {
          if (state?.trigger === target && shown) {
            event.preventDefault();
            event.stopPropagation();
            entered = true;
            focusControl(0);
          } else if (open(target, 'arrow')) {
            event.preventDefault();
            event.stopPropagation();
          }
        }

        return;
      }

      const list = controls();
      if (list.length === 0) {
        return;
      }

      const last = list.length - 1;
      const control = target.closest<HTMLElement>(CONTROLS);
      const at = control === null ? -1 : list.indexOf(control);
      let to: number | null = null;
      if (event.key === 'Tab' && !event.altKey && !event.ctrlKey && !event.metaKey) {
        to = at < 0 ? (event.shiftKey ? last : 0) : at + (event.shiftKey ? -1 : 1);
      } else if (bare && event.key === 'ArrowDown') {
        to = at + 1;
      } else if (bare && event.key === 'ArrowUp') {
        to = at < 0 ? last : at - 1;
      } else if (bare && event.key === 'Home') {
        to = 0;
      } else if (bare && event.key === 'End') {
        to = last;
      }

      if (to !== null) {
        event.preventDefault();
        event.stopPropagation();
        const target = list[(to + list.length) % list.length];
        if (target !== undefined) {
          focusOn(target);
        }
      }
    };

    const onScroll = (event: Event) => {
      const moves = (owner: Element | null) => owner !== null && (event.target === doc || (event.target instanceof Element && event.target.contains(owner)));
      if (moves(state?.trigger ?? null)) {
        end();
      } else if (moves(pending)) {
        cancel();
      }
    };

    const onWindowChange = () => {
      end();
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
    bound = { settle, close: () => {
      end(); 
    } };

    return () => {
      end();
      observer?.disconnect();
      resize?.disconnect();
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
      bound = null;
      attached.delete(doc);
    };
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
    setAvailability: (next) => {
      has = next;
    },
    attach,
    settle: (announce) => {
      bound?.settle(announce);
    },
    close: () => {
      bound?.close();
    },
  };
}
