import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from '../fixtures/app.fixture';
import { openSettingsCategory, saveSettings, settingRow } from '../fixtures/helpers';
import type { Descriptor, Workspace } from '../fixtures/workspace';
import { join } from 'node:path';

const buildTimeout = 20 * 60_000;
const poll = { timeout: buildTimeout, intervals: [500, 1_000, 2_000, 5_000] };
const probeID = 'workspace-probe';

// These are transformations of real, disposable selected sources, not assertions
// about source text. All acceptance assertions below observe rendered consumers,
// authenticated lifecycle state or actual backend transport. Cleanup owns exact
// before/after bytes and restores them only after the CLI proves every group down.
function replaceOnce(source: string, before: string, after: string): string {
  if (source.split(before).length !== 2) {
    throw new Error('Acceptance source prerequisite changed; refusing an ambiguous source edit');
  }

  return source.replace(before, after);
}

async function prepareConsumers(workspace: Workspace): Promise<void> {
  const selected = (await workspace.status()).manifest.plugins;
  if (selected.length < 2 || !selected.some(plugin => plugin.id === 'kubernetes') || !selected.some(plugin => plugin.id === probeID) || selected.some(plugin => plugin.mode !== 'managed')) {
    throw new Error('A17 requires real managed Kubernetes and workspace-probe sources in OMNIVIEW_E2E_SOURCES');
  }

  const repositories = {
    probe: selected.find(plugin => plugin.id === probeID)!.repositoryID,
    kubernetes: selected.find(plugin => plugin.id === 'kubernetes')!.repositoryID,
  };
  await prepareSDKLabelConsumers(workspace, repositories.probe);
  await prepareSharedRuntimeConsumers(workspace, repositories);
}

async function prepareSDKLabelConsumers(workspace: Workspace, probeRepository: string): Promise<void> {
  await workspace.editSource('plugin-sdk', 'settings/setting.go', source => `${source}\n// WithLabel returns a setting with a caller-selected display label.\nfunc (s Setting) WithLabel(label string) Setting {\n\ts.Label = label\n\treturn s\n}\n`);
  await workspace.editSource('omniview', 'internal/settings/terminal.go', source => {
    source = replaceOnce(source, 'settingFontSize: {', 'settingFontSize: settings.Setting{');
    return replaceOnce(source, 'Description: "The size of the font in the terminal",\n\t\t},', 'Description: "The size of the font in the terminal",\n\t\t}.WithLabel("Font Size"),');
  });
  await workspace.editSource(probeRepository, 'pkg/main.go', source => {
    source = replaceOnce(source, 'Settings: []settings.Setting{\n\t\t\t{', 'Settings: []settings.Setting{\n\t\t\tsettings.Setting{');
    return replaceOnce(source, 'Sensitive:   false,\n\t\t\t},', 'Sensitive:   false,\n\t\t\t}.WithLabel("Probe counter"),');
  });
}

async function prepareSharedRuntimeConsumers(workspace: Workspace, repositories: { probe: string; kubernetes: string }): Promise<void> {
  await workspace.editSource('omniview', 'packages/omniviewdev-runtime/src/index.ts', source => `${source}\nexport function workspaceAcceptanceLabel(): string { return 'Shared runtime original'; }\n`);
  await workspace.editSource('ui', 'packages/base-ui/src/theme/styles.css', source => `${source}\n.workspace-host-consumer, .workspace-plugin-consumer, .workspace-kubernetes-consumer { border-top: 3px solid rgb(21, 67, 109) !important; }\n.workspace-host-consumer { position: fixed; bottom: 8px; right: 8px; z-index: 10000; }\n.workspace-header-consumer { position: fixed; bottom: 48px; right: 8px; z-index: 10000; }\n`);
  await workspace.editSource('omniview', 'ui/App.tsx', source => {
    source = `import { workspaceAcceptanceLabel } from '@omniviewdev/runtime';\nimport { actions as headerActions } from './store/header/slice';\n${source}`;
    return replaceOnce(source, '<RouteProvider />', `<RouteProvider />
                                <button type="button" className="workspace-host-consumer" onClick={event => { event.currentTarget.textContent = workspaceAcceptanceLabel(); }}>Read host runtime</button>
                                <button type="button" className="workspace-header-consumer" onClick={() => { store.dispatch(headerActions.setHeaderVisibility(false)); for (const area of ['left', 'center', 'right'] as const) store.dispatch(headerActions.setHeaderAreaVisibility({ area, visible: false })); }}>Hide optional header regions</button>`);
  });
  await workspace.editSource(repositories.probe, 'ui/src/ProbePage.tsx', source => {
    source = `import { workspaceAcceptanceLabel } from '@omniviewdev/runtime';\n${source}`;
    return replaceOnce(source, '<h1 id="workspace-probe-title">Workspace Probe</h1>', `<h1 id="workspace-probe-title">Workspace Probe</h1>
      <Button className="workspace-plugin-consumer" onClick={event => { event.currentTarget.textContent = workspaceAcceptanceLabel(); }}>Read plugin runtime</Button>`);
  });
  await workspace.editSource(repositories.kubernetes, 'ui/src/pages/ClustersPage.tsx', source => {
    source = `import { workspaceAcceptanceLabel } from '@omniviewdev/runtime';\n${source}`;
    source = replaceOnce(source, 'import { Skeleton, Stack, Tabs }', 'import { Button, Skeleton, Stack, Tabs }');
    return replaceOnce(source, '<Stack direction="column" spacing={0} style={fullSizeStyle}>', `<Stack direction="column" spacing={0} style={fullSizeStyle}>
      <Button className="workspace-kubernetes-consumer" onClick={event => { event.currentTarget.textContent = workspaceAcceptanceLabel(); }}>Read Kubernetes runtime</Button>`);
  });
}

async function assertManagedPlugins(workspace: Workspace): Promise<Descriptor> {
  let ready: Descriptor | undefined;
  await expect(async () => {
    const descriptor = await workspace.verify();
    const selected = (await workspace.status()).manifest.plugins;
    expect(selected.length).toBeGreaterThanOrEqual(2);
    for (const selection of selected) {
      const response = await workspace.control('plugin.dev.status', { id: selection.id });
      expect(response.error, `${selection.id} authenticated managed status`).toBeUndefined();
      expect(response.result).toMatchObject({ id: selection.id, mode: 'managed', ready: true, buildStatus: 'ready', viteStatus: 'ready', rpcStatus: 'ready', controllerStatus: 'ready' });
      const plugin = descriptor.plugins.find(plugin => plugin.id === selection.id);
      expect(plugin, `${selection.id} must be included in the actual host descriptor`).toBeDefined();
      expect(plugin!.source).toBe(await workspace.repository(selection.repositoryID));
      expect(plugin!.generation).not.toBe('');
    }

    ready = descriptor;
  }).toPass(poll);
  if (!ready) {
    throw new Error('Managed readiness completed without an authenticated descriptor');
  }

  return ready;
}

async function openProbe(page: Page, workspace: Workspace): Promise<void> {
  await page.goto(`${workspace.browserURL()}#/_plugin/${probeID}/`);
  await expect(page.getByRole('heading', { name: 'Workspace Probe', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Probe increment', exact: true })).toBeVisible();
}

async function openProbeSettings(page: Page): Promise<void> {
  await openSettingsCategory(page, 'Terminal');
  await page.getByRole('navigation').getByText('Workspace Probe', { exact: true }).click();
  await expect(settingRow(page, `${probeID}.probe_counter`).getByRole('spinbutton')).toBeVisible();
}

async function assertBackendEvents(page: Page, workspace: Workspace): Promise<void> {
  const connecting = page.waitForEvent('websocket', socket => new URL(socket.url()).pathname === '/wails/events');
  await page.goto(workspace.browserURL());
  await expect(page.getByTestId('app-shell')).toBeVisible();
  const socket = await connecting;
  const marker = randomUUID();
  const received = socket.waitForEvent('framereceived', { predicate: frame => String(frame.payload).includes(marker) });
  await page.evaluate(async marker => {
    const runtime: unknown = Reflect.get(window, '_wails');
    const clientID: unknown = runtime && typeof runtime === 'object' ? Reflect.get(runtime, 'clientId') : undefined;

    if (!runtime || typeof runtime !== 'object' || typeof clientID !== 'string' || !clientID || typeof Reflect.get(runtime, 'dispatchWailsEvent') !== 'function') {
      throw new Error('Actual app Wails event transport is unavailable');
    }

    const response = await fetch('/wails/runtime', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-wails-client-id': clientID }, body: JSON.stringify({ object: 3, method: 0, args: { name: 'omniview:e2e/consumer', data: { marker } } }) });
    if (!response.ok) {
      throw new Error(`Actual backend event emission failed (${response.status})`);
    }
  }, marker);
  await received;
  expect(socket.isClosed()).toBe(false);
}

async function graphReady(workspace: Workspace, info: TestInfo, stage: string): Promise<void> {
  // Callers first prove their edit's rendered/runtime/process outcome. A fast
  // completed build need not leave a transient non-ready sample to observe.
  await expect(async () => {
    const status = await workspace.status();
    expect({ phase: status.launchPhase, graph: status.builds?.graph?.phase }, `${stage}: the fresh consumer graph must finish ready`).toEqual({ phase: 'ready', graph: 'ready' });
    await workspace.reselect();
  }).toPass(poll);
  const status = await workspace.status();
  const path = info.outputPath(`${stage}-graph.json`);
  await writeFile(path, JSON.stringify({ generation: status.generation, phase: status.launchPhase, builds: Object.fromEntries(Object.entries(status.builds ?? {}).map(([id, build]) => [id, build.phase])) }));
  await info.attach(`${stage}-graph.json`, { path, contentType: 'application/json' });
}

async function reviseSharedRuntimeConsumers(workspace: Workspace): Promise<void> {
  const entry = join(await workspace.repository('omniview'), 'packages/omniviewdev-runtime/dist/index.js');
  const previous = createHash('sha256').update(await readFile(entry)).digest('hex');
  const selected = (await workspace.status()).manifest.plugins;
  const probeRepository = selected.find(plugin => plugin.id === probeID)!.repositoryID;
  const kubernetesRepository = selected.find(plugin => plugin.id === 'kubernetes')!.repositoryID;
  await workspace.editSource('omniview', 'packages/omniviewdev-runtime/src/index.ts', source => `${source}\nexport function workspaceAcceptanceRevision(): string { return 'Shared runtime revised'; }\n`);
  await workspace.editSource('omniview', 'ui/App.tsx', source => source.replaceAll('workspaceAcceptanceLabel', 'workspaceAcceptanceRevision'));
  await workspace.editSource(probeRepository, 'ui/src/ProbePage.tsx', source => source.replaceAll('workspaceAcceptanceLabel', 'workspaceAcceptanceRevision'));
  await workspace.editSource(kubernetesRepository, 'ui/src/pages/ClustersPage.tsx', source => source.replaceAll('workspaceAcceptanceLabel', 'workspaceAcceptanceRevision'));
  await expect(async () => {
    const published = createHash('sha256').update(await readFile(entry)).digest('hex');
    expect(published).not.toBe(previous);
  }).toPass(poll);
}

async function waitForRuntimeConsumers(pages: readonly Page[]): Promise<void> {
  for (const page of pages) {
    await page.waitForFunction(() => {
      const shared: unknown = Reflect.get(window, '__OMNIVIEW_SHARED__');
      if (!shared || typeof shared !== 'object') {
        return false;
      }

      const runtime: unknown = Reflect.get(shared, '@omniviewdev/runtime');
      return !!runtime && typeof runtime === 'object'
        && typeof Reflect.get(runtime, 'workspaceAcceptanceRevision') === 'function';
    }, undefined, { timeout: 120_000 });
  }
}

type SdkLabelBaseline = { descriptor: Descriptor; documentOrigin: number };

async function failSDKLabelBuild(workspace: Workspace, page: Page, info: TestInfo, artifactName: string): Promise<SdkLabelBaseline> {
  const descriptor = await assertManagedPlugins(workspace);
  const documentOrigin = await page.evaluate(() => performance.timeOrigin);
  await workspace.editSource('plugin-sdk', 'settings/setting.go', source => replaceOnce(source, '\ts.Label = label\n', '\ts.Label = )\n'));
  await expect.poll(async () => {
    const status = await workspace.status();
    return { phase: status.launchPhase, graph: status.builds?.graph?.phase };
  }, { ...poll, message: 'Invalid ordinary SDK API must fail the actual graph, not accept stale bindings/backend artifacts' }).toEqual({ phase: 'build-error', graph: 'error' });
  await expect(workspace.verify()).rejects.toThrow();
  const failed = await workspace.status();
  expect(Object.values(failed.builds ?? {}).some(build => build.phase === 'error')).toBe(true);
  // Existing backend availability does not promote a failed new SDK graph.
  expect(failed.generation).toBe(descriptor.generation);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentOrigin);
  const path = info.outputPath(artifactName);
  await writeFile(path, JSON.stringify({ phase: failed.launchPhase, generation: failed.generation, builds: Object.fromEntries(Object.entries(failed.builds ?? {}).map(([id, build]) => [id, build.phase])) }));
  await info.attach(artifactName, { path, contentType: 'application/json' });
  return { descriptor, documentOrigin };
}

async function repairSDKLabelBuild(workspace: Workspace, page: Page, baseline: SdkLabelBaseline, info: TestInfo, stage: string): Promise<Descriptor> {
  await workspace.editSource('plugin-sdk', 'settings/setting.go', source => replaceOnce(source, '\ts.Label = )\n', '\ts.Label = label + " (rebuilt)"\n'));
  await expect.poll(async () => {
    const candidate = (await workspace.status()).instance;
    return !!candidate && candidate.process.startIdentity !== baseline.descriptor.process.startIdentity;
  }, { ...poll, message: 'The repaired SDK must replace the actual host, not reuse its previous ready graph' }).toBe(true);
  await page.waitForFunction(previous => performance.timeOrigin !== previous, baseline.documentOrigin, { timeout: buildTimeout });
  await graphReady(workspace, info, stage);
  const repaired = await assertManagedPlugins(workspace);
  expect(repaired.process.startIdentity).not.toBe(baseline.descriptor.process.startIdentity);
  for (const plugin of baseline.descriptor.plugins) {
    expect(repaired.plugins.find(current => current.id === plugin.id)!.generation).not.toBe(plugin.generation);
  }

  expect((await workspace.status()).builds?.['host-restart']?.phase).toBe('ready');
  // A replacement document repeats cold app bootstrap; controls retain normal deadlines.
  await page.getByTestId('app-shell').waitFor({ timeout: 120_000 });
  return repaired;
}

for (const liveFrontend of [false, true]) {
  const mode = liveFrontend ? 'live' : 'optimized';
  test(`A17 ${mode}: two actual plugin consumers, cross-profile isolation, shared edits and failed/repaired SDK builds`, async ({ profiles }, info) => {
    test.setTimeout(90 * 60_000);
    const a = await profiles.open(`consumer-${mode}-a`, { liveFrontend, watch: true, prepare: prepareConsumers });
    const b = await profiles.open(`consumer-${mode}-b`, { liveFrontend, watch: true, prepare: prepareConsumers });
    const kubeA = await a.page.context().newPage();
    const kubeB = await b.page.context().newPage();
    let stage = 'initial';
    try {
      const beforeA = await assertManagedPlugins(a.workspace);
      const beforeB = await assertManagedPlugins(b.workspace);
      expect(Boolean(beforeA.endpoints.vite)).toBe(liveFrontend);
      expect(beforeA.workspaceID).not.toBe(beforeB.workspaceID);
      expect(beforeA.stateRoot).not.toBe(beforeB.stateRoot);
      for (const plugin of beforeA.plugins) {
        const other = beforeB.plugins.find(other => other.id === plugin.id)!;
        expect(other, `${plugin.id} is required in both profiles`).toBeDefined();
        expect(other.source).not.toBe(plugin.source);
        expect(other.generation).not.toBe(plugin.generation);
      }

      await assertBackendEvents(a.page, a.workspace);
      await assertBackendEvents(b.page, b.workspace);

      await test.step('render both real plugins without human kubeconfig discovery or cloud connections', async () => {
        for (const [profile, kubernetes] of [[a, kubeA], [b, kubeB]] as const) {
          await kubernetes.goto(`${profile.workspace.browserURL()}#/_plugin/kubernetes/`);
          await kubernetes.getByRole('tab', { name: 'All Clusters', exact: true }).click();
          await expect(kubernetes.getByRole('tab', { name: 'All Clusters', exact: true })).toHaveAttribute('aria-selected', 'true');
          const consumer = kubernetes.locator('.workspace-kubernetes-consumer');
          await consumer.click();
          await expect(consumer).toHaveText('Shared runtime original');
          await openProbe(profile.page, profile.workspace);
          await profile.page.getByRole('button', { name: 'Probe increment', exact: true }).click();
          await expect(profile.page.getByRole('status', { name: 'Probe local clicks' })).toHaveText('1');
        }
      });

      await test.step('hide optional header regions through a statically compiled actual Redux consumer in both modes', async () => {
        const header = a.page.getByTestId('app-header');
        await expect(header.getByRole('button', { name: 'home', exact: true })).toBeVisible();
        await a.page.getByRole('button', { name: 'Hide optional header regions', exact: true }).click();
        for (const name of ['home', 'settings', 'plugins']) {
          await expect(header.getByRole('button', { name, exact: true })).toBeHidden();
        }

        await expect(header.getByPlaceholder('Search anything…', { exact: true })).toBeHidden();
        await expect(header.getByRole('button', { name: `DEV · ${beforeA.displayName} — instance details`, exact: true })).toBeVisible();
        await expect(a.page).toHaveTitle(`Omniview — DEV · ${beforeA.displayName}`);
        await a.page.screenshot({ path: info.outputPath(`${mode}-mandatory-identity.png`), fullPage: true });
        await a.page.reload();
      });

      await test.step('persist the same safe plugin ID through actual settings UI without changing B', async () => {
        await openProbeSettings(a.page);
        await settingRow(a.page, `${probeID}.probe_counter`).getByRole('spinbutton').fill('23');
        await saveSettings(a.page);
        await a.page.reload();
        await openProbeSettings(a.page);
        await expect(settingRow(a.page, `${probeID}.probe_counter`).getByRole('spinbutton')).toHaveValue('23');
        await openProbeSettings(b.page);
        await expect(settingRow(b.page, `${probeID}.probe_counter`).getByRole('spinbutton')).toHaveValue('0');
      });

      stage = 'shared-css';
      await openProbe(a.page, a.workspace);
      await openProbe(b.page, b.workspace);
      await expect(a.page.locator('.workspace-host-consumer')).toHaveCSS('border-top-color', 'rgb(21, 67, 109)');
      await expect(a.page.locator('.workspace-plugin-consumer')).toHaveCSS('border-top-color', 'rgb(21, 67, 109)');
      await expect(kubeA.locator('.workspace-kubernetes-consumer')).toHaveCSS('border-top-color', 'rgb(21, 67, 109)');
      await a.workspace.editSource('ui', 'packages/base-ui/src/theme/styles.css', source => replaceOnce(source, 'rgb(21, 67, 109)', 'rgb(149, 41, 73)'));
      // Do not manually reload A: the real consumer refresh/HMR must deliver it.
      await expect(a.page.locator('.workspace-host-consumer')).toHaveCSS('border-top-color', 'rgb(149, 41, 73)', { timeout: buildTimeout });
      await expect(a.page.locator('.workspace-plugin-consumer')).toHaveCSS('border-top-color', 'rgb(149, 41, 73)', { timeout: buildTimeout });
      await expect(kubeA.locator('.workspace-kubernetes-consumer')).toHaveCSS('border-top-color', 'rgb(149, 41, 73)', { timeout: buildTimeout });
      await graphReady(a.workspace, info, `${mode}-css`);
      await expect(kubeB.locator('.workspace-kubernetes-consumer')).toHaveCSS('border-top-color', 'rgb(21, 67, 109)');
      await expect(b.page.locator('.workspace-plugin-consumer')).toHaveCSS('border-top-color', 'rgb(21, 67, 109)');

      stage = 'new-runtime-export';
      await reviseSharedRuntimeConsumers(a.workspace);
      await graphReady(a.workspace, info, `${mode}-runtime`);
      await waitForRuntimeConsumers([a.page, kubeA]);
      await expect(a.page.locator('.workspace-host-consumer')).toBeVisible({ timeout: buildTimeout });
      await a.page.locator('.workspace-host-consumer').click();
      await expect(a.page.locator('.workspace-host-consumer')).toHaveText('Shared runtime revised');
      await a.page.locator('.workspace-plugin-consumer').click();
      await expect(a.page.locator('.workspace-plugin-consumer')).toHaveText('Shared runtime revised');
      await kubeA.locator('.workspace-kubernetes-consumer').click();
      await expect(kubeA.locator('.workspace-kubernetes-consumer')).toHaveText('Shared runtime revised');
      await kubeB.locator('.workspace-kubernetes-consumer').click();
      await expect(kubeB.locator('.workspace-kubernetes-consumer')).toHaveText('Shared runtime original');
      await b.page.locator('.workspace-plugin-consumer').click();
      await expect(b.page.locator('.workspace-plugin-consumer')).toHaveText('Shared runtime original');

      stage = 'sdk-failure';
      const sdkBaseline = await failSDKLabelBuild(a.workspace, a.page, info, `${mode}-sdk-failed-graph.json`);
      const beforeSDK = sdkBaseline.descriptor;
      await assertManagedPlugins(b.workspace);

      stage = 'sdk-repair';
      const repaired = await repairSDKLabelBuild(a.workspace, a.page, sdkBaseline, info, `${mode}-sdk-repaired`);
      await openSettingsCategory(a.page, 'Terminal');
      await expect(settingRow(a.page, 'terminal.fontSize').getByText('Font Size (rebuilt)', { exact: true })).toBeVisible();
      await openProbeSettings(a.page);
      await expect(settingRow(a.page, `${probeID}.probe_counter`).getByText('Probe counter (rebuilt)', { exact: true })).toBeVisible();
      await expect(settingRow(a.page, `${probeID}.probe_counter`).getByRole('spinbutton')).toHaveValue('23');
      await openProbeSettings(b.page);
      await expect(settingRow(b.page, `${probeID}.probe_counter`).getByText('Probe counter', { exact: true })).toBeVisible();
      await expect(settingRow(b.page, `${probeID}.probe_counter`).getByRole('spinbutton')).toHaveValue('0');

      stage = 'restart-isolation';
      const oldPluginGenerations = new Map(repaired.plugins.map(plugin => [plugin.id, plugin.generation]));
      const restarted = await a.workspace.restart();
      expect(restarted.generation).not.toBe(repaired.generation);
      for (const plugin of restarted.plugins) {
        expect(plugin.generation).not.toBe(oldPluginGenerations.get(plugin.id));
      }

      const rejected = await a.workspace.control('settings.set', { scope: 'plugin', pluginID: probeID, id: 'probe_counter', value: 99 }, { generation: repaired.generation });
      expect(rejected.error?.code).toBe('stale_target');
      await assertBackendEvents(a.page, a.workspace);
      await openProbeSettings(a.page);
      await expect(settingRow(a.page, `${probeID}.probe_counter`).getByRole('spinbutton')).toHaveValue('23');
      const unchangedB = await assertManagedPlugins(b.workspace);
      expect(unchangedB.generation).toBe(beforeB.generation);
      expect(unchangedB.process.startIdentity).toBe(beforeB.process.startIdentity);
      for (const plugin of unchangedB.plugins) {
        expect(plugin.generation).toBe(beforeB.plugins.find(original => original.id === plugin.id)!.generation);
      }

      await openProbe(b.page, b.workspace);
      await b.page.locator('.workspace-plugin-consumer').click();
      await expect(b.page.locator('.workspace-plugin-consumer')).toHaveText('Shared runtime original');
      await writeFile(info.outputPath(`${mode}-consumer-identities.json`), JSON.stringify({
        mode, initial: { a: beforeA, b: beforeB }, beforeSDK, repaired, restarted, unchangedB,
      }, null, 2));
      await a.page.screenshot({ path: info.outputPath(`${mode}-sdk-repaired-and-restarted.png`), fullPage: true });
    } catch (error) {
      for (const [name, profile] of [['a', a], ['b', b]] as const) {
        try {
          const status = await profile.workspace.status();
          const failurePath = info.outputPath(`${mode}-${name}-${stage}-failure.json`);
          await writeFile(failurePath, JSON.stringify({
            stage, workspaceID: status.manifest.workspaceID, generation: status.generation, phase: status.launchPhase,
            lastError: status.lastError && { code: status.lastError.code, message: status.lastError.message.slice(0, 2048) },
            plugins: status.instance?.plugins?.map(plugin => ({
              id: plugin.id, generation: plugin.generation,
              build: plugin.buildStatus, vite: plugin.viteStatus, rpc: plugin.rpcStatus, controllers: plugin.controllerStatus,
              lastError: plugin.lastError && { code: plugin.lastError.code, message: plugin.lastError.message.slice(0, 2048) },
            })),
            builds: Object.fromEntries(Object.entries(status.builds ?? {}).map(([id, build]) => [id, { phase: build.phase, error: build.error?.slice(0, 2048) }])),
          }));
          await info.attach(`${mode}-${name}-${stage}-failure.json`, { path: failurePath, contentType: 'application/json' });
          if (!profile.page.isClosed()) {
            await profile.page.screenshot({ path: info.outputPath(`${mode}-${name}-${stage}-failure.png`), fullPage: true });
          }

          const kubernetes = name === 'a' ? kubeA : kubeB;
          if (!kubernetes.isClosed()) {
            await kubernetes.screenshot({ path: info.outputPath(`${mode}-${name}-${stage}-kubernetes-failure.png`), fullPage: true });
          }
        } catch { /* Never replace the original consumer failure or collect private logs/tokens. */ }
      }

      throw error;
    }
  });
}
