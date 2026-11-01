import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/app.fixture';
import { openSettingsCategory, saveSettings } from '../fixtures/helpers';
import { assertBackendEventDelivery } from '../fixtures/events';
import { commitHostSettings, hostSettingsValues } from '../fixtures/wails';

const probeID = 'workspace-probe';
function counterInput(page: Page) {
  return page.getByRole('group', { name: 'Probe counter', exact: true }).getByRole('spinbutton');
}

async function openProbeSettings(page: Page): Promise<Page> {
  const settings = await openSettingsCategory(page, 'Terminal');
  await settings.getByRole('option', { name: 'Workspace Probe', exact: true }).click();
  await expect(counterInput(settings)).toBeVisible();
  return settings;
}

async function saveCounter(page: Page, value: number): Promise<Page> {
  const settings = await openProbeSettings(page);
  await counterInput(settings).fill(String(value));
  await saveSettings(settings);
  return settings;
}

test.describe('Real application plugin consumers', () => {
  test('loads real probe and Kubernetes once through the shared host runtime', async ({ appPage, workspace }) => {
    const descriptor = await workspace.verify();
    expect(descriptor.plugins.map(plugin => plugin.id).sort()).toEqual(['kubernetes', probeID]);
    await appPage.goto(`${workspace.browserURL()}#/_plugin/kubernetes/`);
    const clusters = appPage.getByRole('tab', { name: 'All Clusters', exact: true });
    await clusters.click();
    await expect(clusters).toHaveAttribute('aria-selected', 'true');
    await appPage.goto(`${workspace.browserURL()}#/_plugin/${probeID}/`);
    await expect(appPage.getByRole('heading', { name: 'Workspace Probe', exact: true })).toBeVisible();
    await appPage.getByRole('button', { name: 'Probe increment', exact: true }).click();
    await expect(appPage.getByRole('status', { name: 'Probe local clicks' })).toHaveText('1');
    await appPage.getByRole('button', { name: 'Read shared runtime', exact: true }).click();
    await expect(appPage.getByRole('status', { name: 'Probe runtime connection count' })).toHaveText('4');
    await expect(appPage.locator('.workspace-probe-marker')).toHaveCSS('border-left-color', 'rgb(79, 157, 133)');
  });

  test('persists actual same-ID plugin settings on A while profile B remains zero', async ({ appPage, workspace, profiles }) => {
    const b = await profiles.open('profile-b');
    const beforeB = await b.workspace.verify();
    expect(beforeB.workspaceID).not.toBe((await workspace.verify()).workspaceID);
    const settingsA = await openProbeSettings(appPage);
    await expect(counterInput(settingsA)).toHaveValue('0');
    await counterInput(settingsA).fill('22');
    await settingsA.getByRole('button', { name: 'Increment draft counter', exact: true }).click();
    await expect(counterInput(settingsA)).toHaveValue('23');
    expect(await workspace.control('settings.get', {
      scope: 'plugin', pluginID: probeID, id: 'probe_counter',
    })).toMatchObject({ status: 'succeeded', result: 0 });
    await saveSettings(settingsA);
    const actual = await workspace.control('settings.get', { scope: 'plugin', pluginID: probeID, id: 'probe_counter' });
    expect(actual).toMatchObject({ status: 'succeeded', result: 23 });
    await settingsA.reload();
    await openProbeSettings(appPage);
    await expect(counterInput(settingsA)).toHaveValue('23');
    const settingsB = await openProbeSettings(b.page);
    await expect(counterInput(settingsB)).toHaveValue('0');
    expect(await b.workspace.control('settings.get', { scope: 'plugin', pluginID: probeID, id: 'probe_counter' })).toMatchObject({ status: 'succeeded', result: 0 });
    expect((await b.workspace.verify()).process).toEqual(beforeB.process);
  });

  test('reopens real host and plugin processes with durable settings, storage and event delivery', async ({ appPage, workspace, context, profiles }) => {
    // A real close/reopen is the only case allowed 60s. This is explicit owned
    // process replacement plus document reconnection, not automatic SDK recovery.
    test.setTimeout(60_000);
    const b = await profiles.open('profile-b');
    const beforeB = await b.workspace.verify();
    const beforeSettingB = await b.workspace.control('settings.get', { scope: 'plugin', pluginID: probeID, id: 'probe_counter' });
    expect(beforeSettingB).toMatchObject({ status: 'succeeded', result: 0 });
    const settings = await saveCounter(appPage, 23);
    const committed = await commitHostSettings(appPage.request, { 'terminal.fontSize': 16 });
    expect(committed.applied).toBe(true);
    expect(committed.uncertain).toBe(false);
    const marker = randomUUID();
    await appPage.evaluate(marker => {
      const bootstrap = Reflect.get(window, '__OMNIVIEW_BOOTSTRAP__');
      localStorage.setItem(bootstrap.storageKey('e2e-marker'), marker);
    }, marker);
    const before = await workspace.verify();
    await settings.close();
    const after = await workspace.restart();
    expect(after.generation).not.toBe(before.generation);
    expect(after.process.startIdentity).not.toBe(before.process.startIdentity);
    expect(after.endpoints.browser).toBe(before.endpoints.browser);
    // A truthful explicit reconnect. Do not describe this reload as automatic.
    await appPage.reload();
    await expect(appPage.getByTestId('app-shell')).toBeVisible();
    expect(await appPage.evaluate(() => Reflect.get(window, '__OMNIVIEW_BOOTSTRAP__').identity.generation)).toBe(after.generation);
    const reopenedSettings = await openProbeSettings(appPage);
    await expect(counterInput(reopenedSettings)).toHaveValue('23');
    expect((await hostSettingsValues(appPage.request))['terminal.fontSize']).toBe(16);
    expect(await appPage.evaluate(() => {
      const bootstrap = Reflect.get(window, '__OMNIVIEW_BOOTSTRAP__');
      return localStorage.getItem(bootstrap.storageKey('e2e-marker'));
    })).toBe(marker);
    await assertBackendEventDelivery(appPage, context, workspace.browserURL());
    const afterB = await b.workspace.verify();
    expect(afterB.workspaceID).toBe(beforeB.workspaceID);
    expect(afterB.generation).toBe(beforeB.generation);
    expect(afterB.stateRoot).toBe(beforeB.stateRoot);
    expect(afterB.process).toEqual(beforeB.process);
    expect(afterB.plugins).toEqual(beforeB.plugins);
    expect(afterB.endpoints).toEqual(beforeB.endpoints);
    expect(await b.workspace.control('settings.get', { scope: 'plugin', pluginID: probeID, id: 'probe_counter' })).toMatchObject({ status: 'succeeded', result: beforeSettingB.result });
  });
});
