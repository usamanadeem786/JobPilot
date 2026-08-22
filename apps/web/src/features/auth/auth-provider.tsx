'use client';

import type { AuthSession, AuthUser, LoginInput, RegisterInput } from '@jobpilot/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { apiFetch, setAccessToken } from '@/lib/api-client';

interface AuthContextValue {
  readonly user: AuthUser | null;
  /** True until the initial silent refresh has settled. */
  readonly isLoading: boolean;
  login(input: LoginInput): Promise<void>;
  register(input: RegisterInput): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [user, setUser] = React.useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const router = useRouter();
  const queryClient = useQueryClient();

  /**
   * On mount, try to trade the httpOnly refresh cookie for a fresh access
   * token. This is what makes a page reload keep the user signed in without
   * ever storing a token where a script could read it.
   */
  React.useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const session = await apiFetch<AuthSession>('/auth/refresh', {
          method: 'POST',
          body: {},
          skipRefresh: true,
        });
        if (cancelled) return;
        setAccessToken(session.tokens.accessToken);
        setUser(session.user);
      } catch {
        // No usable cookie: the visitor is simply signed out.
        if (!cancelled) {
          setAccessToken(null);
          setUser(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const applySession = React.useCallback((session: AuthSession) => {
    setAccessToken(session.tokens.accessToken);
    setUser(session.user);
  }, []);

  const login = React.useCallback(
    async (input: LoginInput) => {
      const session = await apiFetch<AuthSession>('/auth/login', {
        method: 'POST',
        body: input,
        skipRefresh: true,
      });
      applySession(session);
    },
    [applySession],
  );

  const register = React.useCallback(
    async (input: RegisterInput) => {
      const session = await apiFetch<AuthSession>('/auth/register', {
        method: 'POST',
        body: input,
        skipRefresh: true,
      });
      applySession(session);
    },
    [applySession],
  );

  const logout = React.useCallback(async () => {
    try {
      await apiFetch<void>('/auth/logout', { method: 'POST', skipRefresh: true });
    } finally {
      // Local state is cleared even if the network call fails, so the UI never
      // shows a signed-in shell for a session the user has ended.
      setAccessToken(null);
      setUser(null);
      queryClient.clear();
      router.replace('/login');
    }
  }, [queryClient, router]);

  const value = React.useMemo<AuthContextValue>(
    () => ({ user, isLoading, login, register, logout }),
    [user, isLoading, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = React.useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside <AuthProvider>.');
  }
  return context;
}
