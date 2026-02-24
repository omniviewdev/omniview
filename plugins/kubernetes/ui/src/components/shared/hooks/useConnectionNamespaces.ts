import { useCallback, useEffect, useRef } from 'react'
import { useStoredState } from './useStoredState'

const SHARED_KEY_PREFIX = 'kubernetes-'
const SHARED_KEY_SUFFIX = '-namespaces'

function sharedKey(connectionID: string): string {
  return `${SHARED_KEY_PREFIX}${connectionID}${SHARED_KEY_SUFFIX}`
}

/**
 * Migrate namespace selection from per-resource column-filters keys to the
 * shared per-connection key. Runs once per connection when no shared key exists.
 *
 * Scans localStorage for keys matching `kubernetes-{connectionID}-*-column-filters`,
 * finds the most recent namespace filter value, and writes it to the shared key.
 * Also strips the namespace entry from all per-resource column-filter keys.
 */
function migrateOnce(connectionID: string): string[] {
  const sk = sharedKey(connectionID)

  // Already migrated — shared key exists
  if (localStorage.getItem(sk) !== null) {
    return JSON.parse(localStorage.getItem(sk)!) as string[]
  }

  const prefix = `kubernetes-${connectionID}-`
  const suffix = '-column-filters'
  let bestNamespaces: string[] = []

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key || !key.startsWith(prefix) || !key.endsWith(suffix)) continue

    try {
      const filters = JSON.parse(localStorage.getItem(key)!) as Array<{ id: string; value: unknown }>
      const nsFilter = filters.find(f => f.id === 'namespace')
      if (nsFilter && Array.isArray(nsFilter.value) && nsFilter.value.length > 0) {
        // Use the longest selection as "most recent" heuristic
        if (nsFilter.value.length > bestNamespaces.length) {
          bestNamespaces = nsFilter.value as string[]
        }
      }

      // Strip namespace entry from per-resource key
      const cleaned = filters.filter(f => f.id !== 'namespace')
      localStorage.setItem(key, JSON.stringify(cleaned))
    } catch {
      // Ignore malformed entries
    }
  }

  // Write the shared key (even if empty — marks migration as done)
  localStorage.setItem(sk, JSON.stringify(bestNamespaces))
  return bestNamespaces
}

/**
 * Shared per-connection namespace selection hook.
 *
 * Stores the selected namespaces at `kubernetes-{connectionID}-namespaces`
 * so that the selection persists across all namespaced resources within a connection.
 */
export function useConnectionNamespaces(connectionID: string) {
  const migrated = useRef(false)

  // Run migration before the first read
  if (!migrated.current) {
    migrateOnce(connectionID)
    migrated.current = true
  }

  const [namespaces, setNamespacesRaw] = useStoredState<string[]>(
    sharedKey(connectionID),
    [],
  )

  // Reset migration flag when connection changes
  useEffect(() => {
    migrated.current = false
  }, [connectionID])

  const setNamespaces = useCallback((value: string[]) => {
    setNamespacesRaw(value)
  }, [setNamespacesRaw])

  return { namespaces, setNamespaces }
}
