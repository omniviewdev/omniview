/** Why the Refresh command cannot be used now: the word written where the person reads the page (ch14 P2), or nothing. */
export function refreshReason(busy: boolean, loading: boolean): string | undefined {
  if (busy) {
    return 'Refreshing';
  }

  return loading ? 'Loading' : undefined;
}
