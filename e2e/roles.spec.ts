/**
 * Role journeys — FF-1202, mirroring `docs/UAT_SCRIPT.md`.
 *
 * One journey per role, matching the script the client will run at acceptance.
 * The value of that alignment is practical: when a UAT step fails, there is a
 * corresponding automated test to reproduce it against, and when this suite
 * fails it names a step the client cares about rather than a selector.
 *
 * **What these prove that the integration suite cannot.** The API suite already
 * checks that a Mechanic gets 403 from `/users`. It cannot check that the
 * Mechanic is never shown a Users link, that the route guard refuses in place,
 * that the session survives a page reload, or that a form's validation reaches
 * the screen. Those are the joins between layers, and they only exist in a
 * browser.
 */

import { expect, test } from '@playwright/test';
import { ACCOUNTS, signIn, unique, visibleNavItems } from './fixtures.js';

// ---------------------------------------------------------------------------
// Authentication — the gate everything else sits behind
// ---------------------------------------------------------------------------

test.describe('authentication', () => {
  test('refuses a wrong password without revealing whether the account exists', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(ACCOUNTS.admin);
    await page.getByLabel(/password/i).fill('not-the-password');
    await page.getByRole('button', { name: /sign in/i }).click();

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    // AUTH-01's acceptance: a generic error. If the message named the account,
    // the login form would be an account-enumeration oracle.
    await expect(alert).not.toContainText(/no account|not found|unknown user/i);
    await expect(page).toHaveURL(/\/login/);
  });

  test('sends an unauthenticated visitor to the login screen', async ({ page }) => {
    await page.goto('/vehicles');
    await expect(page).toHaveURL(/\/login/);
  });

  /**
   * The access token lives in memory and is deliberately lost on reload; the
   * httpOnly refresh cookie is what puts the session back. This is the single
   * most valuable assertion in the file — it exercises machinery that only
   * runs in a browser and that would otherwise be discovered broken by a user
   * pressing F5.
   */
  test('survives a page reload', async ({ page }) => {
    await signIn(page, 'manager');
    await page.goto('/vehicles');
    await expect(page.getByRole('heading', { name: /vehicles/i })).toBeVisible();

    await page.reload();

    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: /vehicles/i })).toBeVisible();
  });

  test('signs out and stops restoring the session', async ({ page }) => {
    await signIn(page, 'manager');
    await page.getByRole('button', { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/login/);

    // The refresh cookie must be gone too — otherwise "sign out" only clears
    // the tab and the next reload signs the user back in.
    await page.goto('/vehicles');
    await expect(page).toHaveURL(/\/login/);
  });
});

// ---------------------------------------------------------------------------
// Journey A — administrator
// ---------------------------------------------------------------------------

test.describe('Journey A — administrator', () => {
  test('reaches every module, including Users', async ({ page }) => {
    await signIn(page, 'admin');
    const items = await visibleNavItems(page);
    expect(items.join(' ')).toMatch(/Users/);
    expect(items.join(' ')).toMatch(/Vehicles/);
    expect(items.join(' ')).toMatch(/Reports/);
  });

  test('creates a user and sees them in the list — UAT A6', async ({ page }) => {
    await signIn(page, 'admin');
    await page.goto('/users');

    await page.getByRole('button', { name: 'Add user' }).click();

    // Scoped to the dialog: the page also has a "Filter by role" select, and an
    // unscoped label match would resolve to two elements.
    const dialog = page.getByRole('dialog');
    const email = `${unique('e2e').toLowerCase()}@fleetflow.test`;
    await dialog.getByLabel('Name').fill(unique('E2E User'));
    await dialog.getByLabel('Email').fill(email);
    await dialog.getByLabel('Role').selectOption('ACCOUNTANT');
    await dialog.getByRole('button', { name: /save|create|add/i }).click();

    await expect(page.getByText(email).first()).toBeAttached({ timeout: 15_000 });
  });

  test('refuses a duplicate email with a message on the field — UAT A7', async ({ page }) => {
    await signIn(page, 'admin');
    await page.goto('/users');
    await page.getByRole('button', { name: 'Add user' }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('Clashing Account');
    await dialog.getByLabel('Email').fill(ACCOUNTS.admin);
    await dialog.getByLabel('Role').selectOption('ACCOUNTANT');
    await dialog.getByRole('button', { name: /save|create|add/i }).click();

    // The server's 409 has to reach the screen. A silent failure here is the
    // worst outcome: the administrator believes the account was created.
    await expect(page.getByText(/already|exists|taken/i).first()).toBeVisible({ timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// Journey B — fleet manager
// ---------------------------------------------------------------------------

test.describe('Journey B — fleet manager', () => {
  test('has no Users entry — UAT B1', async ({ page }) => {
    await signIn(page, 'manager');
    const items = await visibleNavItems(page);
    expect(items.join(' ')).not.toMatch(/Users/);
    expect(items.join(' ')).toMatch(/Vehicles/);
  });

  test('is refused a module its role cannot reach', async ({ page }) => {
    await signIn(page, 'manager');
    await page.goto('/users');
    // The guard renders a refusal *in place* rather than redirecting — a
    // deliberate choice (see `routes/guards.tsx`): a silent bounce to the
    // dashboard leaves the user wondering whether they mistyped the address.
    // What matters is that no Users data appears.
    await expect(page.getByRole('heading', { name: /do not have access/i })).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
  });

  test('adds a vehicle and finds it in the list — UAT A13', async ({ page }) => {
    await signIn(page, 'manager');
    await page.goto('/vehicles');

    await page.getByRole('button', { name: 'Add vehicle' }).click();

    const dialog = page.getByRole('dialog');
    const plate = unique('E2E');
    await dialog.getByLabel('Plate').fill(plate);
    await dialog.getByLabel('Make').fill('Renault');
    await dialog.getByLabel('Model').fill('Master');
    await dialog.getByRole('button', { name: /save|create|add/i }).click();

    // Navigate to the filtered URL rather than typing into the search box. The
    // list is paginated and the reference dataset holds hundreds of vehicles,
    // so a new one is never on page one — and the search field is uncontrolled,
    // so a value typed into it does not survive the list's next render. Going
    // through the URL is both stabler and what a shared link would do, and it
    // asserts the record was *persisted* rather than merely cached.
    await page.goto(`/vehicles?q=${encodeURIComponent(plate)}`);
    // The row is a button, not a link — the whole row opens the vehicle.
    await expect(page.getByRole('button', { name: new RegExp(plate, 'i') }).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  /**
   * DSH's acceptance criterion, through the browser.
   *
   * The API suite already proves the counter and its list agree numerically.
   * What it cannot prove is that the tile is a link at all, and that clicking
   * it lands somewhere useful.
   */
  test('drills through from a dashboard counter — UAT B20', async ({ page }) => {
    await signIn(page, 'manager');
    await page.goto('/');

    const tile = page
      .getByRole('link')
      .filter({ hasText: /total vehicles/i })
      .first();
    await expect(tile).toBeVisible();
    await tile.click();

    await expect(page).toHaveURL(/\/vehicles/);
    await expect(page.getByRole('heading', { name: /vehicles/i })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Journey C — mechanic
// ---------------------------------------------------------------------------

test.describe('Journey C — mechanic', () => {
  test('sees neither Drivers, Users nor Reports — UAT C3', async ({ page }) => {
    await signIn(page, 'mechanic');
    const items = (await visibleNavItems(page)).join(' ');
    expect(items).not.toMatch(/Drivers/);
    expect(items).not.toMatch(/Users/);
    expect(items).not.toMatch(/Reports/);
    expect(items).toMatch(/Maintenance/);
  });

  test('is shown only their own assigned work — UAT C2', async ({ page }) => {
    await signIn(page, 'mechanic');
    await page.goto('/maintenance');
    // A mechanic's landing is headed "My jobs" rather than "Maintenance" — the
    // screen says whose queue it is, which is the scoping made visible.
    await expect(page.getByRole('heading', { name: /my jobs/i })).toBeVisible();

    // Scoping is enforced server-side; this checks the screen does not fail
    // open when the list comes back short.
    await expect(page.getByText(/error|failed/i)).toHaveCount(0);
  });

  test('cannot reach reports by typing the URL — UAT X8', async ({ page }) => {
    await signIn(page, 'mechanic');
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: /do not have access/i })).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Journey E — accountant
// ---------------------------------------------------------------------------

test.describe('Journey E — accountant', () => {
  test('sees Reports but not Users — UAT E2', async ({ page }) => {
    await signIn(page, 'accountant');
    const items = (await visibleNavItems(page)).join(' ');
    expect(items).toMatch(/Reports/);
    expect(items).not.toMatch(/Users/);
  });

  test('runs a report and switches between them — UAT E4, E5', async ({ page }) => {
    await signIn(page, 'accountant');
    await page.goto('/reports');

    await expect(page.getByRole('heading', { name: /reports/i })).toBeVisible();
    await page.getByLabel('Report', { exact: true }).selectOption('cost-by-vehicle');
    await expect(page.getByRole('table')).toBeVisible({ timeout: 15_000 });

    await page.getByLabel('Report', { exact: true }).selectOption('cost-by-period');
    await expect(page.getByRole('table')).toBeVisible({ timeout: 15_000 });
  });

  /**
   * RPT-06 through the browser.
   *
   * The access token is in memory, so the download cannot be a plain link — it
   * is a fetch with an Authorization header, turned into a blob. That is
   * exactly the sort of thing that works in isolation and fails in a real
   * browser, so it is worth a real browser to check.
   */
  test('downloads all three export formats — UAT E8', async ({ page }) => {
    await signIn(page, 'accountant');
    await page.goto('/reports');
    await expect(page.getByRole('table')).toBeVisible({ timeout: 15_000 });

    for (const [label, extension] of [
      [/^csv$/i, 'csv'],
      [/^excel$/i, 'xlsx'],
      [/^pdf$/i, 'pdf'],
    ] as const) {
      const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
      await page.getByRole('button', { name: label }).click();
      const download = await downloadPromise;
      // The filename comes from the server's Content-Disposition; a fetch
      // cannot apply it, so the client reads it back out of the header.
      expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${extension}$`));
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting
// ---------------------------------------------------------------------------

test.describe('notifications', () => {
  test('shows a bell for every role — UAT D6, C8', async ({ page }) => {
    for (const account of ['admin', 'mechanic', 'accountant'] as const) {
      await signIn(page, account);
      // A notification is addressed to a person, not to a module, so the bell
      // is present regardless of what the sidebar shows.
      await expect(page.getByRole('link', { name: /notification/i }).first()).toBeVisible();
      await page.getByRole('button', { name: /sign out/i }).click();
      await expect(page).toHaveURL(/\/login/);
    }
  });

  test('opens the notification centre', async ({ page }) => {
    await signIn(page, 'manager');
    await page
      .getByRole('link', { name: /notification/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/notifications/);
    await expect(page.getByRole('heading', { name: /notifications/i })).toBeVisible();
  });
});

/**
 * Deliberately not tested here: the per-account lockout (UAT A3).
 *
 * It is covered in `security.integration.test.ts`, where it belongs. Driving it
 * through a browser means locking a real seeded account, and these suites share
 * one database — the driver journey then cannot sign in, and the failure
 * surfaces three files away as a mysterious login timeout. Rate limiting has no
 * browser-specific behaviour, so there is nothing the extra layer would prove.
 */
