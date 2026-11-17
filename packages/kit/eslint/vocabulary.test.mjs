// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { formatFailures, scanText, scanTrees } from './vocabulary.mjs';

const BEGIN = '// SCAFFOLDING(N19): begin';
const END = '// SCAFFOLDING(N19): end';

describe('the real trees', () => {
  it('hold no plugin vocabulary outside a marked scaffolding directory or region', () => {
    const result = scanTrees();
    expect([...result.hits, ...result.problems].length, formatFailures(result)).toBe(0);
  });
});

describe('scanText', () => {
  const words = ['Pods', 'pod', 'kubectl get', 'namespace', 'Namespaces', 'KUBERNETES', 'k8s', 'kubeconfig', 'kube'];
  for (const word of words) {
    it(`flags "${word}"`, () => {
      const { hits } = scanText(`const a = 1;\n// ${word}\n`, 'x.ts');
      expect(hits).toHaveLength(1);
      expect(hits[0]).toMatchObject({ file: 'x.ts', line: 2 });
    });
  }

  for (const token of ['usePods', 'PodsSkeleton', 'isPod', 'podName', 'KubernetesClient', 'namespaceName', 'kubectlVersion', 'HTMLPod']) {
    it(`flags the identifier ${token}, reporting the whole token`, () => {
      const { hits } = scanText(`const a = 1;\nexport const x = ${token}(1);\n`, 'x.ts');
      expect(hits).toEqual([{ file: 'x.ts', line: 2, word: token }]);
    });
  }

  it('does not flag ordinary words: cluster, podcast, spod, episode, namespacing, ThemeProvider, Stack', () => {
    expect(scanText('a cluster of items; podcast spod episode namespacing ThemeProvider Stack\n').hits).toEqual([]);
  });

  it('exempts only between matched markers, markers included', () => {
    const text = ['Pods', BEGIN, 'Pods and kubectl', END, 'namespace'].join('\n');
    const { hits, problems } = scanText(text, 'x.ts');
    expect(hits.map((hit) => [hit.line, hit.word])).toEqual([[1, 'Pods'], [5, 'namespace']]);
    expect(problems).toEqual([]);
  });

  it('accepts any comment syntax for the markers', () => {
    expect(scanText('<!-- SCAFFOLDING(N19): begin -->\npods\n<!-- SCAFFOLDING(N19): end -->\n').hits).toEqual([]);
    expect(scanText('/* SCAFFOLDING(N19): begin */\n.pods {}\n/* SCAFFOLDING(N19): end */\n').hits).toEqual([]);
  });

  it('fails on an unmatched begin, and the region it opens is not an exemption to the end of the file', () => {
    const { problems } = scanText(['a', BEGIN, 'pods'].join('\n'), 'x.ts');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ file: 'x.ts', line: 2 });
  });

  it('fails on an unmatched end, and on a nested begin', () => {
    expect(scanText(['pods', END].join('\n'), 'x.ts').problems).toHaveLength(1);
    expect(scanText([BEGIN, BEGIN, END].join('\n'), 'x.ts').problems).toHaveLength(1);
  });
});

describe('scanTrees on a temporary tree', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'vocabulary-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const put = (file, text) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  };

  put('packages/kit/src/Probe.tsx', 'export const a = "Pods";\n');
  put('packages/kit/src/probe.css', '.pods { color: red; }\n');
  put('packages/kit/src/ok.ts', 'export const a = "cluster";\n');
  put('packages/kit/eslint/probe.mjs', 'kubectl get pods\n');
  put('packages/kit/node_modules/x/index.js', 'kubectl\n');
  put('packages/kit/dist/x.js', 'kubectl\n');
  put('packages/kit/src/notes.txt', 'kubectl\n');
  put('ui-next/shell/Frame.tsx', 'const q = "kubectl get";\n');
  put('ui-next/shell/Marked.tsx', `${BEGIN}\nconst q = "namespace";\n${END}\n`);
  put('ui-next/shell/Unmatched.tsx', `${BEGIN}\nconst q = 1;\n`);
  put('ui-next/k8s/usePods.ts', 'namespace pods kubectl\n');
  put('ui-next/pods/Page.tsx', 'Pods\n');
  put('ui-next/e2e/pods.spec.ts', 'Pods\n');

  it('flags the shell, the kit and a css file; skips scaffolding, the guard folder and build output', () => {
    const { hits, problems } = scanTrees(root);
    expect(hits.map((hit) => `${hit.file}:${hit.line}:${hit.word}`).sort()).toEqual([
      'packages/kit/src/Probe.tsx:1:Pods',
      'packages/kit/src/probe.css:1:pods',
      'ui-next/shell/Frame.tsx:1:kubectl',
    ]);
    expect(problems.map((problem) => problem.file)).toEqual(['ui-next/shell/Unmatched.tsx']);
  });

  it('says where the vocabulary goes', () => {
    const message = formatFailures(scanTrees(root));
    expect(message).toContain('packages/kit/src/Probe.tsx:1:Pods');
    expect(message).toContain('decision A13');
    expect(message).toContain('scaffolding directory');
  });

  it('a missing tree is skipped', () => {
    expect(scanTrees(path.join(root, 'nothing-here'))).toEqual({ hits: [], problems: [] });
  });
});
