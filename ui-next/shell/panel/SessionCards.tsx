import { HoverCardHost, type HoverCardContent } from '@omniviewdev/kit';
import { useCallback } from 'react';
import { usePanel } from './context';
import { SessionCard } from './SessionCard';
import { sessionName } from './words';

/**
 * The one card of the window (the kit's `HoverCardHost`, mounted once beside the shell): what a session tab shows on hover and keyboard focus (ch16 SCD1). The tab is the trigger by its
 * session id; this answers the key with the card's name, its announcement and its content, which subscribes to its own session. A key that is not a session of a visible tab has no card.
 */
export function SessionCards() {
  const { store } = usePanel();
  const render = useCallback(
    (key: string): HoverCardContent | undefined => {
      const item = store.selectors.sessionItem(store.getSnapshot(), key);
      return item === undefined
        ? undefined
        : { label: `${sessionName(item)}, details`, content: <SessionCard id={key} />, announce: `${item.name}. Press Down Arrow to reach its actions.` };
    },
    [store],
  );
  return <HoverCardHost render={render} />;
}
