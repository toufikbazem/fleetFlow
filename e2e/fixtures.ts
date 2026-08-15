/**
 * Shared E2E helpers — FF-1202.
 *
 * Sign-in goes through the real login form rather than injecting a token. That
 * is the point of an end-to-end test: the token lives in memory by design, the
 * session is restored from an httpOnly cookie, and a suite that sets a token
 * directly would skip exactly the machinery most likely to break.
 */

import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'FleetFlow-Dev-2026!';

export const ACCOUNTS = {
  admin: 'admin@fleetflow.local',
  manager: 'manager@fleetflow.local',
  mechanic: 'mechanic@fleetflow.local',
  accountant: 'accountant@fleetflow.local',
  driver: 'amina@fleetflow.local',
} as const;

export type AccountName = keyof typeof ACCOUNTS;

export async function signIn(page: Page, account: AccountName): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(ACCOUNTS[account]);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();

  // Waiting for the URL rather than for a spinner to vanish: the redirect is
  // the observable outcome of a successful sign-in, and a spinner assertion
  // races the render.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
}

/** The navigation entries this role can see — the visible half of AUTH-06. */
export async function visibleNavItems(page: Page): Promise<string[]> {
  const nav = page.getByRole('navigation', { name: /main/i });
  await expect(nav).toBeVisible();
  return (await nav.getByRole('link').allInnerTexts()).map((text) => text.trim());
}

/** Unique enough that a rerun does not collide with the last run's rows. */
export function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}
