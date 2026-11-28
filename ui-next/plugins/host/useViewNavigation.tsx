import { ConfirmDialog } from '@omniviewdev/kit';
import { useCallback, useState } from 'react';
import type { NoticesStore, TabsStore } from '../../shell';
import { navigationOrigin, sameRoute, type TabRoute, type NavigationOrigin, type OpenHow } from '../../shell/core/tabs';

export type OpenView = (route: TabRoute, how: OpenHow, source: 'sidebar' | 'link' | 'menu',
  allowed?: () => boolean, origin?: NavigationOrigin, arrived?: () => void) => void;

/** A press is tied to the initiating location and exact binding, including across an unsaved-changes dialog. A link is a locator, not a binding. */
export function useViewNavigation(tabs: TabsStore, notices: NoticesStore) {
  const [confirm, setConfirm] = useState<(() => void) | null>(null);
  const [selection, setSelection] = useState(0);
  const open = useCallback<OpenView>((route, how, source, allowed, requestedOrigin, arrived) => {
    const origin = requestedOrigin ?? navigationOrigin(tabs.getSnapshot());
    function dispatch(confirmed: boolean): void {
      if (allowed && !allowed()) {
        return;
      }

      const options = { origin, confirmed, source };
      const result = how === 'here' && origin.id !== null
        ? tabs.navigate(origin.id, { route }, { ...options, history: 'push', reuse: false })
        : tabs.open({ route }, { ...options, how: how === 'here' ? 'new' : how });
      if (result.status === 'confirm') {
        setConfirm(() => () => {
          setConfirm(null);
          dispatch(true);
        });
      } else if (result.status === 'refused') {
        notices.notify({ severity: 'error', title: 'Couldn\'t open view', detail: result.message, initiator: 'user' });
      } else if (arrived && result.status === 'done') {
        arrived();
      } else if (route.kind === 'extension-view' && how === 'here' && (result.status === 'noop' || result.status === 'done') && origin.location && sameRoute(origin.location.route, route)) {
        // Explicitly selecting a withdrawn view is fresh demand, without a second entry in history.
        setSelection(n => n + 1);
      }
    }

    dispatch(false);
  }, [tabs, notices]);
  const dialog = confirm && <ConfirmDialog title="Discard unsaved changes?" message="Opening this view discards the changes in this tab." confirmLabel="Discard" tone="danger" onConfirm={confirm} onCancel={() => {
    setConfirm(null);
  }} />;
  return { open, selection, dialog };
}
