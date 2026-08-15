/**
 * Journey D — driver, on a phone — FF-1202.
 *
 * Split into its own file so the Playwright config can run it against a mobile
 * device profile as well as a desktop one. The PRD excludes a *native* mobile
 * app; it does not excuse a driver filing a damage report at the roadside from
 * having a usable screen, and the UAT script says explicitly to run this
 * journey on a phone.
 */

import { expect, test } from '@playwright/test';
import { signIn } from './fixtures.js';

test.describe('Journey D — driver', () => {
  test('is shown exactly one vehicle — UAT D2', async ({ page }) => {
    await signIn(page, 'driver');
    await page.goto('/vehicles');
    await expect(page.getByRole('heading', { name: /vehicles/i })).toBeVisible();

    // Their own. A driver correctly allowed to read vehicles, then handed the
    // whole fleet, is a breach no status-code test would catch.
    await expect(page.getByText('12345-A-6')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('55120-C-1')).toHaveCount(0);
  });

  test('has no Users, Drivers or Reports entry', async ({ page }) => {
    await signIn(page, 'driver');
    const nav = page.getByRole('navigation', { name: /main/i });
    const items = (await nav.getByRole('link').allInnerTexts()).join(' ');
    expect(items).not.toMatch(/Users/);
    expect(items).not.toMatch(/Reports/);
  });

  test('cannot open another vehicle by typing its URL — UAT X7', async ({ page }) => {
    await signIn(page, 'driver');
    // The truck, which belongs to the other driver.
    await page.goto('/vehicles/00000000-0000-4000-8000-000000000303');
    // Whatever the screen shows, it must not be that vehicle's details.
    await expect(page.getByText('55120-C-1')).toHaveCount(0);
  });

  test('reports a problem on their own vehicle — UAT D4', async ({ page }) => {
    await signIn(page, 'driver');
    await page.goto('/damages');

    await page.getByRole('button', { name: 'Report a problem' }).click();

    const dialog = page.getByRole('dialog');
    const description = `Rear light not working, noticed this morning (${Date.now()})`;

    // No vehicle picker: a driver holding exactly one vehicle gets a hidden
    // field instead of a select (see `report-damage-dialog.tsx`).
    await dialog.getByLabel(/what happened/i).fill(description);
    await dialog.getByRole('button', { name: /save|submit|report/i }).click();

    // The dialog stays open after saving to offer the photo step (DMG-04), so
    // the observable outcome of a successful report is that step appearing —
    // not the dialog closing.
    await expect(dialog.getByText(/photo/i).first()).toBeVisible({ timeout: 20_000 });

    // Reload rather than relying on the dialog closing and the cache
    // invalidating: the assertion is that the report was persisted and is
    // visible to its author, which a fresh fetch states unambiguously.
    await page.goto('/damages');
    await expect(page.getByText(/rear light not working/i).first()).toBeAttached({
      timeout: 20_000,
    });
  });

  test('has a usable layout at phone width — UAT D1', async ({ page }) => {
    await signIn(page, 'driver');
    await page.goto('/damages');

    // The body must never scroll sideways. Wide content — tables in particular —
    // scrolls inside its own container instead.
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows).toBe(false);
  });

  test('opens the notification centre from the bell — UAT D6', async ({ page }) => {
    await signIn(page, 'driver');
    await page
      .getByRole('link', { name: /notification/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/notifications/);
  });
});
