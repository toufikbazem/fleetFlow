/**
 * Every route the app actually registers — FF-1207.
 *
 * Read out of the live Express router rather than maintained by hand. That is
 * the whole point: a hand-written list of endpoints to check is a list somebody
 * forgets to update, and the endpoint that gets forgotten is the one shipped in
 * a hurry — which is also the one most likely to be missing its guard.
 *
 * With this, "every shipped route is covered" is a computed claim, and adding a
 * route without classifying it fails the suite.
 */

import type { Express } from 'express';

export interface RegisteredRoute {
  method: string;
  path: string;
}

interface Layer {
  route?: { path?: string; methods?: Record<string, boolean> };
  handle?: { stack?: Layer[] };
}

/**
 * Walks the router tree.
 *
 * Express nests a sub-router's layers under `handle.stack`, and this app mounts
 * ten of them under one prefix, so a single-level scan finds only `/healthz`.
 */
export function registeredRoutes(app: Express): RegisteredRoute[] {
  const found: RegisteredRoute[] = [];

  function walk(layers: Layer[] | undefined, depth: number): void {
    if (depth > 6) return;
    for (const layer of layers ?? []) {
      if (layer.route?.path) {
        for (const [method, enabled] of Object.entries(layer.route.methods ?? {})) {
          // Express records a HEAD alongside every GET; they share a handler and
          // therefore share a guard, so checking both proves nothing twice.
          if (enabled && method !== 'head' && method !== '_all') {
            found.push({ method: method.toUpperCase(), path: layer.route.path });
          }
        }
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack, depth + 1);
      }
    }
  }

  walk((app as unknown as { router?: { stack?: Layer[] } }).router?.stack, 0);
  return found;
}

/** `GET /vehicles/:id` — the key used to match a route against its classification. */
export function routeKey(route: RegisteredRoute): string {
  return `${route.method} ${route.path}`;
}
