import type { APIRequestContext, Page } from '@playwright/test';
import { test as base, expect } from '../fixtures/app.fixture';
import { goTo } from '../fixtures/helpers';
import { callBinding, mockBindings, Service } from '../fixtures/wails';

/**
 * Real-application evidence for provider-declared custom resource cells and the drawers a plugin
 * supplies (issue #95).
 *
 * The workspace probe's Go provider declares `ColumnDefinition.component` columns for its `vm`
 * type, and its built UI bundle contributes the renderer at `omniview/resource/cell` and a drawer
 * for the same type. Nothing between the plugin and the host is simulated: the table is the host's
 * generic resource browser fed by the real provider process through the real runtime, and the
 * bundle reaches the page through the real module transport.
 *
 * Plugin lifecycle is driven through the app's own PluginService:
 * - reload and load: events published on the real backend event bus, the transport its listeners
 *   use (`plugin/update_complete` reloads a loaded plugin, `plugin/install_finished` loads one);
 * - unload: the real Uninstall flow of the plugin page. Only the destructive `UninstallPlugin`
 *   binding is answered by the test, so the backend plugin keeps running while the UI really
 *   unloads it. Marketplace reads are answered empty to keep the test off the network.
 *
 * The resource browser withholds the table of a plugin that is not loaded, so a mounted table can
 * only show a cell as Unavailable while its plugin is loaded: when its renderer was never
 * registered, or a reload or load brought a bundle that no longer contributes it (the probe bundle
 * can be told to leave its renderer out). After a real unload the first test therefore asserts that
 * the cell and its registry entry are gone, and that the table of a plugin loaded again without the
 * renderer says Unavailable. The drawer belongs to the shell, so the second test observes its
 * Unavailable state right after a reload and after the real unload.
 */

const pluginID = 'workspace-probe';
const connectionID = 'hypervisor-bundled-vms';
const resourceType = 'vm';
const tablePath = `/resources/${pluginID}/${connectionID}?type=${resourceType}`;
const moduleURL = `/_/plugins/${pluginID}/assets/entry.js`;
// What the probe's Go provider declares for its node column; the renderer must receive it verbatim.
const nodeParams = { badge: 'node', emphasis: true };
// Plugin lifecycle runs through the backend, the module transport and React: allow for it.
const lifecycle = { timeout: 15_000 };

type PluginInfo = { id: string; metadata: { id: string; name: string; version: string } };
type ColumnDefinition = { id: string; accessor: string; component?: string; componentParams?: unknown };
type ProbeWindow = Window & {
  __workspaceProbeResourceCell?: { instances: number; contribute?: boolean };
  __e2eCellStates?: string[];
};
declare const window: ProbeWindow;

// The probe connection is started through the browser's own Connect action. Stop it afterwards, so
// the shared profile keeps the state the test found.
const test = base.extend<{ stopProbeConnection: void }>({
  stopProbeConnection: [async ({ request }, use) => {
    await use();
    await callBinding(request, Service.resource, 'StopConnection', pluginID, connectionID);
    const status = await callBinding<{ status: string }>(request, Service.resource, 'CheckConnection', pluginID, connectionID);
    expect(status.status, 'the probe connection is stopped again').toBe('DISCONNECTED');
  }, { auto: true }],
});

/** Publishes on the real backend event bus: the transport PluginService listens on. */
async function emitBackendEvent(request: APIRequestContext, name: string, data: unknown): Promise<void> {
  const response = await request.post('/wails/runtime', {
    headers: { 'x-wails-client-id': 'e2e' },
    data: { object: 3, method: 0, args: { name, data } },
  });
  expect(response.ok(), `publishing ${name}`).toBe(true);
}

/** How many times the page has evaluated the probe bundle: the newest evaluation's number. */
const evaluatedBundles = async (page: Page) => page.evaluate(() => window.__workspaceProbeResourceCell?.instances ?? 0);

/** Makes the next evaluation of the probe bundle ship, or leave out, its resource cell renderer. */
async function shipCellRenderer(page: Page, ship: boolean): Promise<void> {
  await page.evaluate((value) => {
    const hook = window.__workspaceProbeResourceCell;
    if (hook) {
      hook.contribute = value;
    }
  }, ship);
}

const tableOf = (page: Page) => page.locator('.table-container table');
const rowOf = (page: Page, name: string) => tableOf(page).locator('tbody tr').filter({ has: page.getByText(name, { exact: true }) });

/** Opens the probe's VM table, connecting through the browser's own Connect action. */
async function openVMTable(page: Page): Promise<void> {
  await goTo(page, tablePath);
  const connect = page.getByRole('button', { name: 'Connect and continue' });
  const types = page.getByRole('navigation', { name: 'Resource types' });
  await expect(connect.or(types)).toBeVisible(lifecycle);
  if (await connect.isVisible()) {
    await connect.click();
  }

  await expect(types).toBeVisible(lifecycle);
  await expect(tableOf(page)).toBeVisible(lifecycle);
}

/**
 * Runs the plugin page's real Uninstall flow. Only `UninstallPlugin` is answered here, so the
 * backend keeps the plugin while the UI's PluginService really unloads it.
 */
async function uninstallThroughPluginPage(page: Page, info: PluginInfo): Promise<void> {
  const uninstallCalls: unknown[][] = [];
  await mockBindings(page, Service.plugins, {
    UninstallPlugin: (args: unknown[]) => {
      uninstallCalls.push(args);
      return info;
    },
    ListAvailablePlugins: [],
    GetPluginVersions: [],
    GetPluginReadme: '',
    GetPluginReviews: [],
    GetPluginReleaseHistory: [],
  });
  await goTo(page, `/plugins/${pluginID}`);
  await page.getByRole('button', { name: 'Uninstall', exact: true }).click();
  const dialog = page.locator('[role="dialog"], [role="presentation"]').filter({ hasText: `Uninstall ${info.metadata.name}?` }).last();
  await expect(dialog).toBeVisible();
  expect(uninstallCalls).toEqual([]);
  await dialog.getByRole('button', { name: 'Uninstall', exact: true }).click();
  await expect.poll(() => uninstallCalls, lifecycle).toEqual([[pluginID]]);
  await expect(page).toHaveURL(/#\/plugins$/);
}

test.describe('Plugin-contributed resource cells and drawers', () => {
  test('a provider-declared cell renders through plugin load, reload, withdrawal, unload and load again', async ({ appPage: page, request }, testInfo) => {
    const facts: Array<Record<string, unknown>> = [];
    const moduleRequests: string[] = [];
    page.on('request', (message) => {
      if (new URL(message.url()).pathname === moduleURL) {
        moduleRequests.push(message.url());
      }
    });
    const shot = async (name: string) => testInfo.attach(`${name}.png`, { body: await page.screenshot(), contentType: 'image/png' });

    const table = tableOf(page);
    const row = rowOf(page, 'db');
    const nodeTd = row.locator('td').nth(2);
    const nodeCell = row.getByTestId('probe-cell');
    const unavailable = row.locator('[data-state="unavailable"]');
    const instanceOfCell = async () => Number(await nodeCell.getByTestId('probe-cell-instance').innerText());
    const record = async (step: string) => {
      const cells = await nodeCell.count();
      facts.push({
        step,
        cell: cells === 1
          ? {
            data: await nodeCell.getByTestId('probe-cell-data').innerText(),
            params: await nodeCell.getByTestId('probe-cell-params').innerText(),
            moduleInstance: await instanceOfCell(),
          }
          : null,
        unavailableCells: await unavailable.count(),
        tableMounted: await table.count() === 1 ? await table.getAttribute('data-e2e-mounted') : 'no table',
        bundleEvaluations: await evaluatedBundles(page),
        moduleRequests: moduleRequests.length,
      });
    };

    const info = await callBinding<PluginInfo>(request, Service.plugins, 'GetPlugin', pluginID);
    expect(info.id).toBe(pluginID);

    try {
      await test.step('load: the provider-declared custom cell renders real provider data', async () => {
        await openVMTable(page);
        await expect(nodeCell).toBeVisible(lifecycle);
        await expect(nodeCell.getByTestId('probe-cell-data')).toHaveText('node/a::1');
        // The column declaration the cell was built from comes from the real provider process.
        const definition = await callBinding<{ columnDefs: ColumnDefinition[] }>(request, Service.resource, 'GetResourceDefinition', pluginID, { connection: connectionID }, resourceType);
        expect(definition.columnDefs.map(({ id, accessor, component }) => ({ id, accessor, component }))).toEqual([
          { id: 'name', accessor: 'name' },
          { id: 'node', accessor: 'node', component: 'workspace-probe/node-badge' },
          { id: 'host', accessor: 'host', component: 'workspace-probe/unregistered-cell' },
        ]);
        expect(definition.columnDefs[1]?.componentParams).toEqual(nodeParams);
        // The declaration's componentParams reach the renderer verbatim.
        await expect(nodeCell.getByTestId('probe-cell-params')).toHaveText(JSON.stringify(nodeParams));
        // The newest evaluation of the bundle owns the renderer on screen.
        expect(await instanceOfCell()).toBe(await evaluatedBundles(page));
        // A column whose renderer nobody registered says so, and the plain column stays a text cell.
        await expect(unavailable).toHaveCount(1);
        await expect(unavailable).toHaveText('Unavailable');
        await expect(row.locator('[data-state="ready"]')).toHaveCount(1);
        await expect(row.locator('td').nth(1)).toHaveText('db');
        await record('loaded');
        await shot('1-loaded');
      });

      const loaded = await instanceOfCell();
      await table.evaluate((element) => {
        element.dataset.e2eMounted = 'initial';
      });
      await row.evaluate((element) => {
        element.dataset.e2eMounted = 'initial';
      });
      // Record every state the node cell passes through, to prove a swap never shows a gap.
      await nodeTd.evaluate((element) => {
        const states: string[] = [];
        window.__e2eCellStates = states;
        new MutationObserver(() => {
          states.push(element.querySelector('[data-state]')?.getAttribute('data-state') ?? 'blank');
        }).observe(element, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-state'] });
      });

      await test.step('reload: a new bundle evaluation replaces the renderer while the table stays mounted', async () => {
        const requestsBefore = moduleRequests.length;
        await emitBackendEvent(request, 'plugin/update_complete', { pluginID, version: info.metadata.version });
        await expect.poll(instanceOfCell, lifecycle).toBeGreaterThan(loaded);
        expect(await instanceOfCell()).toBe(await evaluatedBundles(page));
        expect(moduleRequests.length).toBeGreaterThan(requestsBefore);
        await expect(nodeCell.getByTestId('probe-cell-params')).toHaveText(JSON.stringify(nodeParams));
        // Same table, same row: React swapped the renderer in place.
        await expect(table).toHaveAttribute('data-e2e-mounted', 'initial');
        await expect(row).toHaveAttribute('data-e2e-mounted', 'initial');
        // The swap is atomic: the cell never rendered Unavailable or an empty gap in between.
        const states = await page.evaluate(() => window.__e2eCellStates ?? []);
        expect(states.length).toBeGreaterThan(0);
        expect(states.filter((state) => state !== 'ready')).toEqual([]);
        await record('reloaded');
        await shot('2-reloaded');
      });
      const reloaded = await instanceOfCell();

      await test.step('withdrawal: a reload whose bundle no longer contributes the renderer renders Unavailable in place', async () => {
        await shipCellRenderer(page, false);
        const evaluationsBefore = await evaluatedBundles(page);
        await emitBackendEvent(request, 'plugin/update_complete', { pluginID, version: info.metadata.version });
        await expect(nodeCell).toHaveCount(0, lifecycle);
        await expect(nodeTd.locator('[data-state="unavailable"]')).toHaveText('Unavailable');
        await expect(unavailable).toHaveCount(2);
        expect(await evaluatedBundles(page)).toBeGreaterThan(evaluationsBefore);
        await expect(table).toHaveAttribute('data-e2e-mounted', 'initial');
        await record('withdrawn');
        await shot('3-withdrawn');
      });

      await test.step('contribution restored: the next reload renders the cell again', async () => {
        await shipCellRenderer(page, true);
        await emitBackendEvent(request, 'plugin/update_complete', { pluginID, version: info.metadata.version });
        await expect(nodeCell).toBeVisible(lifecycle);
        await expect(unavailable).toHaveCount(1);
        expect(await instanceOfCell()).toBe(await evaluatedBundles(page));
        expect(await instanceOfCell()).toBeGreaterThan(reloaded);
        await expect(table).toHaveAttribute('data-e2e-mounted', 'initial');
        await record('restored');
      });
      const restored = await instanceOfCell();

      await test.step('registry: the cell contribution is owned by the loaded plugin', async () => {
        await goTo(page, `/developer-tools/extensions?plugin=${pluginID}&point=${encodeURIComponent('omniview/resource/cell')}`);
        const contributions = page.getByRole('table', { name: 'Registered contributions' });
        const registered = contributions.getByRole('row').filter({ hasText: 'probe-node-cell' });
        await expect(registered).toContainText(pluginID, lifecycle);
        facts.push({ step: 'registry loaded', contribution: await registered.innerText() });
        await shot('4-registry-loaded');
      });

      await test.step('unload: the real Uninstall flow unloads the plugin and the table cannot render its cell', async () => {
        await uninstallThroughPluginPage(page, info);
        await goTo(page, `/developer-tools/extensions?plugin=${pluginID}&point=${encodeURIComponent('omniview/resource/cell')}`);
        await expect(page.getByRole('status').filter({ hasText: 'No contributions match these filters.' })).toBeVisible(lifecycle);
        facts.push({ step: 'registry unloaded', contributions: 'none' });
        // The resource browser withholds the table of a plugin that is not loaded; it never shows a stale cell.
        await goTo(page, tablePath);
        await expect(page.getByRole('status').filter({ hasText: `Loading ${pluginID}…` })).toBeVisible(lifecycle);
        await expect(table).toHaveCount(0);
        await expect(page.getByTestId('probe-cell')).toHaveCount(0);
        await record('unloaded');
        await shot('5-unloaded');
      });

      await test.step('load again: the table returns with a newly evaluated renderer', async () => {
        await emitBackendEvent(request, 'plugin/install_finished', info.metadata);
        await expect(nodeCell).toBeVisible(lifecycle);
        await expect(nodeCell.getByTestId('probe-cell-data')).toHaveText('node/a::1');
        await expect(nodeCell.getByTestId('probe-cell-params')).toHaveText(JSON.stringify(nodeParams));
        expect(await instanceOfCell()).toBeGreaterThan(restored);
        expect(await instanceOfCell()).toBe(await evaluatedBundles(page));
        await expect(unavailable).toHaveCount(1);
        // A new table: the unload really removed the old one.
        await expect(table).not.toHaveAttribute('data-e2e-mounted', 'initial');
        await record('loaded again');
        await shot('6-loaded-again');
      });

      await test.step('unload again, then load a bundle without the renderer: the re-rendered table says Unavailable', async () => {
        await shipCellRenderer(page, false);
        await uninstallThroughPluginPage(page, info);
        await goTo(page, tablePath);
        await expect(page.getByRole('status').filter({ hasText: `Loading ${pluginID}…` })).toBeVisible(lifecycle);
        await emitBackendEvent(request, 'plugin/install_finished', info.metadata);
        // The plugin is back and the table is up, but nothing renders the node column: never a stale or blank cell.
        await expect(nodeTd.locator('[data-state="unavailable"]')).toHaveText('Unavailable', lifecycle);
        await expect(nodeCell).toHaveCount(0);
        await expect(unavailable).toHaveCount(2);
        await record('unloaded, loaded again without the renderer');
        await shot('7-unavailable-after-unload');
      });
    } finally {
      console.log(`[resource-cells] ${JSON.stringify(facts)}`);
      await testInfo.attach('resource-cell-facts.json', { body: JSON.stringify(facts, null, 2), contentType: 'application/json' });
    }
  });

  test('an open plugin drawer becomes the host Unavailable drawer when its plugin reloads or unloads', async ({ appPage: page, request }, testInfo) => {
    const facts: Array<Record<string, unknown>> = [];
    const shot = async (name: string) => testInfo.attach(`${name}.png`, { body: await page.screenshot(), contentType: 'image/png' });
    const table = tableOf(page);
    const row = rowOf(page, 'db');
    const drawerView = page.getByTestId('probe-drawer-view');
    const drawerInstance = page.getByTestId('probe-drawer-instance');
    const unavailable = page.getByRole('status').filter({ hasText: 'Unavailable' });
    // The drawer header names the resource by its provider id, whoever supplied the drawer.
    const resourceName = page.getByText('101', { exact: true });
    const openedInstance = async () => Number(await drawerInstance.innerText());
    const openDrawer = async () => {
      await row.getByText('db', { exact: true }).click();
      await expect(drawerView).toBeVisible(lifecycle);
      await expect(page.getByTestId('probe-drawer-name')).toHaveText('db');
      await expect(resourceName).toBeVisible();
      expect(await openedInstance()).toBe(await evaluatedBundles(page));
    };

    const closeDrawer = async () => {
      await page.keyboard.press('Escape');
      await expect(drawerView.or(unavailable)).toHaveCount(0, lifecycle);
    };

    const expectUnavailableDrawer = async () => {
      await expect(unavailable).toBeVisible(lifecycle);
      await expect(unavailable).toContainText(pluginID);
      await expect(unavailable).toContainText('no longer loaded or was reloaded');
      await expect(drawerView).toHaveCount(0);
      await expect(page.getByRole('tab', { name: 'Probe view' })).toHaveCount(0);
      await expect(resourceName).toBeVisible();
    };

    const info = await callBinding<PluginInfo>(request, Service.plugins, 'GetPlugin', pluginID);

    try {
      await openVMTable(page);
      await table.evaluate((element) => {
        element.dataset.e2eMounted = 'initial';
      });

      await test.step('open: a row click shows the drawer the plugin supplied', async () => {
        await openDrawer();
        await expect(page.getByText('Probe VM', { exact: true })).toBeVisible();
        facts.push({ step: 'opened', moduleInstance: await openedInstance(), bundleEvaluations: await evaluatedBundles(page) });
        await shot('1-drawer-opened');
      });
      const opened = await openedInstance();

      await test.step('reload: the open drawer is replaced by the host Unavailable drawer', async () => {
        await emitBackendEvent(request, 'plugin/update_complete', { pluginID, version: info.metadata.version });
        await expectUnavailableDrawer();
        await expect.poll(async () => evaluatedBundles(page), lifecycle).toBeGreaterThan(opened);
        // The table under the drawer stays mounted and shows the newly evaluated renderer.
        await expect(table).toHaveAttribute('data-e2e-mounted', 'initial');
        await expect(row.getByTestId('probe-cell-instance')).toHaveText(String(await evaluatedBundles(page)), lifecycle);
        facts.push({ step: 'reloaded', bundleEvaluations: await evaluatedBundles(page) });
        await shot('2-drawer-unavailable-after-reload');
      });

      await test.step('reopen: the next row click shows the drawer of the newly loaded bundle', async () => {
        await closeDrawer();
        await expect(unavailable).toHaveCount(0, lifecycle);
        await openDrawer();
        expect(await openedInstance()).toBeGreaterThan(opened);
        facts.push({ step: 'reopened', moduleInstance: await openedInstance() });
      });
      const reopened = await openedInstance();

      await test.step('unload: the real Uninstall flow replaces the open drawer with the Unavailable drawer', async () => {
        await uninstallThroughPluginPage(page, info);
        // The drawer belongs to the shell, so it is still open on the plugin pages.
        await expectUnavailableDrawer();
        facts.push({ step: 'unloaded', drawer: 'unavailable' });
        await shot('3-drawer-unavailable-after-unload');
        await closeDrawer();
        await expect(unavailable).toHaveCount(0, lifecycle);
      });

      await test.step('load again: a new row click shows the drawer of the reloaded plugin', async () => {
        await goTo(page, tablePath);
        await expect(page.getByRole('status').filter({ hasText: `Loading ${pluginID}…` })).toBeVisible(lifecycle);
        await emitBackendEvent(request, 'plugin/install_finished', info.metadata);
        await expect(tableOf(page)).toBeVisible(lifecycle);
        await openDrawer();
        expect(await openedInstance()).toBeGreaterThan(reopened);
        facts.push({ step: 'loaded again', moduleInstance: await openedInstance() });
        await shot('4-drawer-after-load');
      });
    } finally {
      console.log(`[resource-drawers] ${JSON.stringify(facts)}`);
      await testInfo.attach('resource-drawer-facts.json', { body: JSON.stringify(facts, null, 2), contentType: 'application/json' });
    }
  });
});
