type Falsy = false | 0 | 0n | '' | null | undefined;

/**
 * `value || fallback` as a function: returns `value` when it is truthy and
 * `fallback` otherwise. Use it where an empty string, `0`, `false` or `NaN`
 * must fall back too, which `??` would not do.
 */
export function orFallback<T, F>(value: T, fallback: F): Exclude<T, Falsy> | F {
  if (value) {
    return value as Exclude<T, Falsy>;
  }

  return fallback;
}
