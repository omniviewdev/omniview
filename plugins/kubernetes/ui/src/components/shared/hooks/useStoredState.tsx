import { useCallback, useEffect, useRef, useState } from 'react'

export function useStoredState<T = any>(
  key: string,
  defaultValue: T | (() => T)
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const isMounted = useRef(false)

  // Lazy initializer reads from localStorage
  const [state, setState] = useState<T>(() => {
    try {
      const item = localStorage.getItem(key)
      if (item !== null) {
        return JSON.parse(item) as T
      }
    } catch (e) {
      console.warn(`Error reading localStorage key "${key}":`, e)
    }
    return typeof defaultValue === 'function' ? (defaultValue as () => T)() : defaultValue
  })

  // Sync state to localStorage when it changes
  useEffect(() => {
    if (!isMounted.current) {
      isMounted.current = true
      return
    }

    try {
      localStorage.setItem(key, JSON.stringify(state))
    } catch (e) {
      console.warn(`Error writing to localStorage key "${key}":`, e)
    }
  }, [key, state])

  // Optional: stable setter (no unnecessary rerenders)
  const setPersistedState = useCallback<React.Dispatch<React.SetStateAction<T>>>(
    (value) => {
      setState((prev) => {
        const next = typeof value === 'function' ? (value as (prevState: T) => T)(prev) : value
        return next
      })
    },
    []
  )

  return [state, setPersistedState]
}
