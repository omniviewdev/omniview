import { useState, useCallback, useRef, useMemo } from 'react';

/**
 * Hook for managing form state with dirty tracking and reset.
 *
 * @param initialValues - The initial form values (from resource data)
 * @returns Form state, setter, dirty flag, and reset function
 *
 * @example
 * ```
 * const { values, setValue, dirty, reset } = useFormState({
 *   DesiredCount: service.DesiredCount ?? 0,
 *   LaunchType: service.LaunchType ?? 'FARGATE',
 * });
 * ```
 */
export function useFormState<T extends Record<string, any>>(initialValues: T) {
  const initialRef = useRef(initialValues);
  const [values, setValues] = useState<T>(initialValues);

  const setValue = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const setField = useCallback((key: string, value: any) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const dirty = useMemo(() => {
    const keys = Object.keys(initialRef.current);
    return keys.some((k) => values[k] !== initialRef.current[k]);
  }, [values]);

  const reset = useCallback(() => {
    setValues(initialRef.current);
  }, []);

  const reinitialize = useCallback((newInitial: T) => {
    initialRef.current = newInitial;
    setValues(newInitial);
  }, []);

  return { values, setValue, setField, dirty, reset, reinitialize };
}

export default useFormState;
