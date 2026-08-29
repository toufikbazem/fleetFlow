/**
 * Theme preference — FF-1105.
 *
 * Three states, not two. "System" is the default and it is a real choice: a
 * fleet manager who has set their laptop to switch at dusk expects FleetFlow to
 * switch with it, and an app that latched onto whichever mode it saw first
 * would stop following. Only an explicit pick is stored.
 *
 * The class is applied to <html> here *and* by an inline script in index.html.
 * The duplication is deliberate: the script runs before first paint so the page
 * never flashes the wrong theme, and this module keeps it in step afterwards.
 * Both read the same storage key, defined once below.
 */

import { useCallback, useEffect, useState } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'fleetflow.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function readStored(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    // Private browsing refuses localStorage. Following the OS is the right
    // fallback, and it is what the pre-paint script assumed too.
    return 'system';
  }
}

function prefersDark(): boolean {
  return window.matchMedia(DARK_QUERY).matches;
}

function apply(preference: ThemePreference): void {
  const dark = preference === 'dark' || (preference === 'system' && prefersDark());
  document.documentElement.classList.toggle('dark', dark);
}

export interface ThemeValue {
  preference: ThemePreference;
  /** What is actually on screen once "system" has been resolved. */
  resolved: 'light' | 'dark';
  setPreference: (preference: ThemePreference) => void;
  /** Flips to the opposite of what is currently shown, and pins it. */
  toggle: () => void;
}

export function useTheme(): ThemeValue {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStored);
  const [systemDark, setSystemDark] = useState(() => prefersDark());

  // Kept in sync while the preference is "system": the OS can change at dusk,
  // or the user can change it in another window.
  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent): void => setSystemDark(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    apply(preference);
  }, [preference, systemDark]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try {
      if (next === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The choice still applies to this tab; it just will not survive a reload.
    }
  }, []);

  const resolved: 'light' | 'dark' =
    preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  const toggle = useCallback(() => {
    setPreference(resolved === 'dark' ? 'light' : 'dark');
  }, [resolved, setPreference]);

  return { preference, resolved, setPreference, toggle };
}
