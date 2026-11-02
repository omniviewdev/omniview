// SemVer precedence ignores build metadata and compares prerelease identifiers numerically.
export function compareVersions(left: string, right: string): number {
  const parse = (value: string) => {
    const [core, ...pre] = value.replace(/^v/, '').split('+')[0].split('-');
    return { core: core.split('.').map(Number), pre: pre.join('-').split('.').filter(Boolean) };
  };

  const a = parse(left);
  const b = parse(right);
  for (let i = 0; i < 3; i++) {
    const diff = (a.core[i] ?? 0) - (b.core[i] ?? 0);
    if (diff) {
      return diff;
    }
  }

  if (!a.pre.length || !b.pre.length) {
    return Number(!a.pre.length) - Number(!b.pre.length);
  }

  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === undefined || y === undefined) {
      return Number(x !== undefined) - Number(y !== undefined);
    }

    if (x === y) {
      continue;
    }

    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      return Number(x) - Number(y);
    }

    if (xn !== yn) {
      return xn ? -1 : 1;
    }

    return x < y ? -1 : 1;
  }

  return 0;
}

export function orderedVersions<T extends { version: string }>(versions: readonly T[]): T[] {
  return [...new Map(versions.map(version => [version.version, version])).values()]
    .sort((a, b) => compareVersions(b.version, a.version));
}
