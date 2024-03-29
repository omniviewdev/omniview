/**
 * Find a value in an object by a list of keys.
 */
export function findValueByKeys<T>(obj: T, keys: string[]): string {
  for (const key of keys) {
    /* eslint-disable */
    let currentObject: any = obj;
    const keyParts = key.split(".");
    let found = true;

    for (let part of keyParts) {
      if (
        currentObject &&
        typeof currentObject === "object" &&
        part in currentObject
      ) {
        currentObject = currentObject[part];
      } else {
        found = false;
        break;
      }
    }

    if (found) {
      // Ensuring the found value is a string before returning it.
      // If the value is not a string, you might want to return a string representation or handle it differently
      return typeof currentObject === "string" ? currentObject : "";
    }
  }
  return "";
}

export function hasKey<T>(obj: T, key: string): boolean {
  return key.split(".").every((x) => {
    if (typeof obj !== "object" || obj === null || !(x in obj)) {
      return false;
    }
    // @ts-ignore
    obj = obj[x];
    return true;
  });
}

export function containsKey(
  obj: Record<string, string> | undefined,
  key: string,
): boolean {
  if (!obj) return false;
  return key in obj;
}

export function containsKeyWithPrefix(
  obj: Record<string, string> | undefined,
  prefix: string,
): boolean {
  if (!obj) return false;
  return Object.keys(obj).some((key) => key.startsWith(prefix));
}
