import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, ApiError, clearCsrfToken } from '../api/client';
import type { ApiUser, MfaProof } from '../api/client';
import { FlagProvider } from '../flags/FlagContext';

interface AuthContextValue {
  user: ApiUser | null;
  /** True while the initial `/me` check is in flight. */
  loading: boolean;
  /** Password verification succeeded, but a second factor is still required. */
  pendingMfa: boolean;
  login: (email: string, password: string) => Promise<'authenticated' | 'mfa'>;
  verifyMfa: (proof: MfaProof) => Promise<void>;
  cancelMfa: () => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingMfa, setPendingMfa] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { user } = await api.me();
      setUser(user);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
      } else {
        // Network or unexpected error: treat as logged out but don't crash.
        setUser(null);
      }
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      await refresh();
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login(email, password);
    if (res.mfaRequired) {
      setUser(null);
      setPendingMfa(true);
      return 'mfa';
    }
    setPendingMfa(false);
    setUser(res.user);
    return 'authenticated';
  }, []);

  const verifyMfa = useCallback(async (proof: MfaProof) => {
    if (!pendingMfa) {
      throw new Error('No multi-factor authentication challenge is active.');
    }
    const { user: verifiedUser } = await api.verifyMfa(proof);
    setUser(verifiedUser);
    setPendingMfa(false);
  }, [pendingMfa]);

  const register = useCallback(async (email: string, password: string) => {
    await api.register(email, password);
    setUser(null);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      clearCsrfToken();
      setUser(null);
      setPendingMfa(false);
    }
  }, []);

  const cancelMfa = useCallback(async () => {
    await logout();
  }, [logout]);

  const value = useMemo(
    () => ({ user, loading, pendingMfa, login, verifyMfa, cancelMfa, register, logout }),
    [user, loading, pendingMfa, login, verifyMfa, cancelMfa, register, logout],
  );

  return (
    <AuthContext.Provider value={value}>
      <FlagProvider authLoading={loading} userId={user?.id ?? null}>
        {children}
      </FlagProvider>
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
