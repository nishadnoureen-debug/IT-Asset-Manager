'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { PermissionKey } from '@itam/shared';
import { api, ApiError, session } from './api-client';

export interface Profile {
  id: string;
  email: string;
  displayName: string;
  employeeId: string | null;
  lastLoginAt: string | null;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    employeeNumber: string;
    department: { id: string; name: string } | null;
    location: { id: string; name: string } | null;
  } | null;
  roles: string[];
  permissions: string[];
}

interface SessionResponse {
  accessToken: string;
  expiresIn: number;
  user: Profile;
}

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  status: Status;
  user: Profile | null;
  login(email: string, password: string): Promise<Profile>;
  logout(): Promise<void>;
  reload(): Promise<void>;
  /** True when the user holds at least one of the permissions. UI only — the API enforces access. */
  can(...anyOf: PermissionKey[]): boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<Profile | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const apply = useCallback((result: SessionResponse | null) => {
    clearTimeout(timer.current);
    if (!result) {
      session.setToken(null);
      setUser(null);
      setStatus('anonymous');
      return;
    }
    session.setToken(result.accessToken);
    setUser(result.user);
    setStatus('authenticated');
    // Refresh proactively one minute before the access token expires.
    timer.current = setTimeout(() => void session.refresh(), Math.max(30, result.expiresIn - 60) * 1000);
  }, []);

  const refresh = useCallback(async (): Promise<boolean> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { data } = await api.post<SessionResponse>('/auth/refresh', {}, { anonymous: true });
        apply(data);
        return true;
      } catch (error) {
        // A parallel tab may have rotated the cookie a moment ago — retry once with the new cookie.
        if (attempt === 0 && error instanceof ApiError && error.status === 401) {
          await new Promise((r) => setTimeout(r, 400));
          continue;
        }
        if (!(error instanceof ApiError) || error.status !== 0) apply(null);
        return false;
      }
    }
    return false;
  }, [apply]);

  useEffect(() => {
    session.onRefresh(refresh);
    void session.refresh();
    return () => {
      session.onRefresh(null);
      clearTimeout(timer.current);
    };
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      const { data } = await api.post<SessionResponse>('/auth/login', { email, password }, { anonymous: true });
      apply(data);
      return data.user;
    },
    [apply],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', {}, { anonymous: true });
    } finally {
      apply(null);
    }
  }, [apply]);

  const reload = useCallback(async () => {
    const { data } = await api.get<Profile>('/auth/me');
    setUser(data);
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const permissions = new Set(user?.permissions ?? []);
    return {
      status,
      user,
      login,
      logout,
      reload,
      can: (...anyOf) => anyOf.some((p) => permissions.has(p)),
    };
  }, [status, user, login, logout, reload]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
