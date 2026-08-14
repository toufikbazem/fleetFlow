/**
 * Session state — FF-1101.
 *
 * Holds the authenticated user and exposes the permission helpers every screen
 * uses to decide what to render. Those helpers are thin wrappers over `MATRIX`
 * from @fleetflow/shared — the same object the API enforces.
 *
 * That shared table is the whole point: the UI cannot offer an action the API
 * will refuse, and it cannot quietly permit one either. It mirrors access; it
 * never decides it. Hiding a button is a courtesy to the user, not a security
 * control — the server has already been asked the same question.
 */

import {
  isAllowed,
  visibleModules,
  type Action,
  type AuthenticatedUser,
  type MeResponse,
  type Module,
} from '@fleetflow/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  apiRequest,
  login as apiLogin,
  logout as apiLogout,
  restoreSession,
} from './api-client.js';

export interface SessionValue {
  user: AuthenticatedUser | null;
  /** True until the boot-time refresh attempt has settled. */
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  can: (module: Module, action: Action) => boolean;
  modules: Module[];
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState(true);

  // On boot, try to turn a surviving httpOnly refresh cookie back into a
  // session. Without this, every page reload would look like a sign-out.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        if (await restoreSession()) {
          const me = await apiRequest<MeResponse>('/auth/me');
          if (!cancelled) setUser(me.user);
        }
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await apiLogin(email, password);
    setUser(result.user);
  }, []);

  const signOut = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      user,
      loading,
      signIn,
      signOut,
      can: (module, action) => (user ? isAllowed(user.role, module, action) : false),
      modules: user ? visibleModules(user.role) : [],
    }),
    [user, loading, signIn, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used inside a SessionProvider');
  }
  return context;
}

/** Convenience for a screen that is already behind a guard. */
export function useCurrentUser(): AuthenticatedUser {
  const { user } = useSession();
  if (!user) throw new Error('useCurrentUser used outside an authenticated route');
  return user;
}
