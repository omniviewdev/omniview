// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { formatFailures, RATCHET, ratchetFailures, scanText, scanTrees, TREES } from './vocabulary.mjs';

describe('the real trees', () => {
  it('hold no plugin vocabulary, beyond the ratchet: not in the shell, the page, the plugin host, the e2e files, the shell probes or the kit', () => {
    const hits = scanTrees();
    const failures = ratchetFailures(hits);
    expect(failures, `${formatFailures(hits)}\n${failures.join('\n')}`).toEqual([]);
  });

  it('the ratchet lists only files that exist', () => {
    const files = new Set(scanTrees().map((hit) => hit.file));
    for (const file of Object.keys(RATCHET)) expect(files.has(file), file).toBe(true);
  });

  it('leaves out three places and no more: the guard, the mock recordings and the neutral fixture plugin', () => {
    expect(TREES).toEqual([
      { dir: 'packages/kit', skipped: ['packages/kit/eslint', 'packages/kit/probes'] },
      { dir: 'ui-next', skipped: ['ui-next/plugins/fixture'] },
    ]);
  });
});

describe('ratchetFailures', () => {
  const hit = (file) => ({ file, line: 1, word: 'Pod' });

  it('fails a file that is not listed, on its first word', () => {
    expect(ratchetFailures([hit('a.ts')], {})).toEqual(['a.ts: 1 plugin words, none allowed']);
  });

  it('fails a listed file that gains a word, and one that has none left', () => {
    expect(ratchetFailures([hit('a.ts'), hit('a.ts')], { 'a.ts': 1 })).toEqual(['a.ts: 2 plugin words, 1 allowed']);
    expect(ratchetFailures([], { 'a.ts': 1 })).toEqual(['a.ts: no plugin word left, remove it from RATCHET']);
  });

  it('passes a listed file at or under its allowance', () => {
    expect(ratchetFailures([hit('a.ts')], { 'a.ts': 2 })).toEqual([]);
  });
});

describe('scanText', () => {
  const words = ['Pods', 'pod', 'kubectl get', 'namespace', 'Namespaces', 'KUBERNETES', 'k8s', 'kubeconfig', 'kube'];
  for (const word of words) {
    it(`flags "${word}"`, () => {
      const hits = scanText(`const a = 1;\n// ${word}\n`, 'x.ts');
      expect(hits).toHaveLength(1);
      expect(hits[0]).toMatchObject({ file: 'x.ts', line: 2 });
    });
  }

  for (const token of ['usePods', 'PodsSkeleton', 'isPod', 'podName', 'KubernetesClient', 'namespaceName', 'kubectlVersion', 'HTMLPod']) {
    it(`flags the identifier ${token}, reporting the whole token`, () => {
      expect(scanText(`const a = 1;\nexport const x = ${token}(1);\n`, 'x.ts')).toEqual([{ file: 'x.ts', line: 2, word: token }]);
    });
  }

  it('does not flag ordinary words: cluster, podcast, spod, episode, namespacing, ThemeProvider, Stack', () => {
    expect(scanText('a cluster of items; podcast spod episode namespacing ThemeProvider Stack\n')).toEqual([]);
  });

  it('has no escape comment: the markers of the old scaffolding exempt nothing', () => {
    const text = ['// SCAFFOLDING(N19): begin', 'Pods and kubectl', '// SCAFFOLDING(N19): end'].join('\n');
    expect(scanText(text, 'x.ts').map((hit) => [hit.line, hit.word])).toEqual([[2, 'Pods'], [2, 'kubectl']]);
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
  put('packages/kit/probes/mock-measure.mjs', "K8s.connections.defaultScope('prod-eu');\n");
  put('packages/kit/node_modules/x/index.js', 'kubectl\n');
  put('packages/kit/dist/x.js', 'kubectl\n');
  put('packages/kit/src/notes.txt', 'kubectl\n');
  put('ui-next/shell/Frame.tsx', 'const q = "kubectl get";\n');
  // The places that used to be exempt (the plugin scaffolding, the real-cluster check, the marked regions) are scanned like the rest.
  put('ui-next/k8s/usePods.ts', 'namespace pods kubectl\n');
  put('ui-next/pods/Page.tsx', 'Pods\n');
  put('ui-next/e2e/pods.spec.ts', 'Pods\n');
  put('ui-next/shell/probes/targets.mjs', "// SCAFFOLDING(N19): begin\nconst open = \"K8s.route.make('k8s-resources')\";\n// SCAFFOLDING(N19): end\n");
  // The neutral fixture plugin is a plugin, not the host.
  put('ui-next/plugins/fixture/src/entry.tsx', 'export const note = "pods of a plugin of its own";\n');
  put('ui-next/plugins/host/PluginHost.tsx', 'export const a = "namespace";\n');

  it('flags the shell, the plugin host, the kit, a css file, and the places that used to be exempt; skips the guard, the mock recordings, the fixture plugin and build output', () => {
    expect(
      scanTrees(root)
        .map((hit) => `${hit.file}:${hit.line}:${hit.word}`)
        .sort(),
    ).toEqual([
      'packages/kit/src/Probe.tsx:1:Pods',
      'packages/kit/src/probe.css:1:pods',
      'ui-next/e2e/pods.spec.ts:1:Pods',
      'ui-next/k8s/usePods.ts:1:namespace',
      'ui-next/k8s/usePods.ts:1:pods',
      'ui-next/k8s/usePods.ts:1:kubectl',
      'ui-next/pods/Page.tsx:1:Pods',
      'ui-next/plugins/host/PluginHost.tsx:1:namespace',
      'ui-next/shell/Frame.tsx:1:kubectl',
      'ui-next/shell/probes/targets.mjs:2:K8s',
      'ui-next/shell/probes/targets.mjs:2:k8s',
    ].sort());
  });

  it('says where the vocabulary goes', () => {
    const message = formatFailures(scanTrees(root));
    expect(message).toContain('packages/kit/src/Probe.tsx:1:Pods');
    expect(message).toContain('decision A13');
    expect(message).toContain("the plugin's own repository");
  });

  it('a missing tree is skipped', () => {
    expect(scanTrees(path.join(root, 'nothing-here'))).toEqual([]);
  });
});
