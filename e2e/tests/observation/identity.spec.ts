import { test, expect } from '@playwright/test';
import { observationalWorkspace } from '../fixtures/workspace';

// Deliberately NOT app.fixture: no setting snapshots/resets, terminal closes,
// plugin mutations, lifecycle operations, or owned-process cleanup on attachment.
test('observes only the explicitly selected authenticated UUID and generation', async ({ page }, testInfo) => {
  const workspace = observationalWorkspace();
  const descriptor = await workspace.verify();
  await page.goto(workspace.browserURL());
  const chip = page.getByRole('button', { name: `DEV · ${descriptor.displayName} — instance details`, exact: true });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page.getByRole('dialog').getByText(descriptor.generation, { exact: true })).toBeVisible();
  await expect(page.getByText('Identity confirmed by the host.', { exact: true })).toBeVisible();
  await workspace.verify();
  await page.screenshot({ path: testInfo.outputPath('observed-workspace.png'), fullPage: true });
});
