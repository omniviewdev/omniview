import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactElement, type ReactNode } from 'react';
import { createHoverCards } from './controller';
import styles from './HoverCard.module.css';

/** What the card of one key says and holds. */
export type HoverCardContent = {
  /** The accessible name of the card: it becomes the `aria-label` of its `dialog`. */
  readonly label: string;
  /**
   * What the card holds. React draws it inside the host's own element, so the providers above the host apply to it (a link needs its provider),
   * and it may subscribe to the application's stores. Nothing in it is `aria-hidden`.
   */
  readonly content: ReactNode;
  /**
   * One sentence, said once and politely when keyboard focus opens the card and the card has a link or a button in it: how to reach them
   * ("Press Down Arrow to reach its actions."). It is not said for a pointer, and not when the Down arrow already took the focus in.
   */
  readonly announce?: string | undefined;
};

export type HoverCardHostProps = {
  /**
   * The content of the card of `key` (the `data-ov-card` of the trigger), or `undefined` when there is none now: a card that is open closes,
   * and one that is waiting for its delay never opens. It is a plain function of the key and of what the host is rendered with, called while
   * the host renders and to ask whether a card exists: it must not call hooks. What in the card changes by itself is a component in `content`
   * that subscribes to its own store, never `render` being called again.
   */
  readonly render: (key: string) => HoverCardContent | undefined;
};

/**
 * The one hover card of the window: mount it once, at the application root, beside the `ThemeProvider` and the `TooltipHost`. It renders a
 * single popover element (`role="dialog"`, in the top layer) and listens on the document for the triggers of the whole page, however many
 * there are: `{...hoverCard('key')}` on an element, and `{...hoverCardAnchor()}` on the ancestor the card is placed against.
 *
 * A card opens when the pointer rests on a trigger (500 ms) or keyboard focus reaches it, stays while the pointer or the focus is on the
 * trigger or the card, and never takes the focus on its own: the Down arrow on a trigger made with `{ arrow: 'down' }` moves it in, Escape
 * closes the card and returns it. The tooltip host is plain text and cannot hold a link or a button; this is its interactive sibling.
 *
 * A second host in one window throws, as a second tooltip host does: the whole point is one popup.
 */
export function HoverCardHost({ render }: HoverCardHostProps): ReactElement {
  const popover = useRef<HTMLDivElement>(null);
  const region = useRef<HTMLDivElement>(null);
  const [cards] = useState(createHoverCards);
  const card = useSyncExternalStore(cards.subscribe, cards.getSnapshot, getNone);
  const content = card === null ? undefined : render(card.key);

  useEffect(() => {
    cards.setAvailability((key) => render(key) !== undefined);
  }, [cards, render]);

  useEffect(() => {
    const element = popover.current;
    const live = region.current;
    return element === null || live === null ? undefined : cards.attach(element, live);
  }, [cards]);

  // After every commit that holds a card: nothing to show closes it; else the popover is shown, measured and placed with its content in.
  useLayoutEffect(() => {
    if (card === null) {
      return;
    }

    if (content === undefined) {
      cards.close();
    } else {
      cards.settle(content.announce);
    }
  });

  return (
    <>
      <div ref={popover} role="dialog" popover="manual" aria-label={content?.label} className={styles.root} data-ov-part="hover-card">
        {card === null || content === undefined ? null : (
          <div key={card.key} className={styles.body}>
            {content.content}
          </div>
        )}
      </div>
      <div ref={region} role="status" aria-live="polite" className={styles.status} />
    </>
  );
}

/** The server snapshot: no card is open before anything has happened. */
function getNone(): null {
  return null;
}
