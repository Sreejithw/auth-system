import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, ApiError, clearCsrfToken } from '../api/client';
import type { ApiUser, MfaProof, SessionInfo } from '../api/client';
import { FlagProvider } from '../flags/FlagContext';

interface AuthContextValue {
  user: ApiUser | null;
  isAdmin: boolean;
  session: SessionInfo | null;
  /** True while the initial `/me` check is in flight. */
  loading: boolean;
  /** Password verification succeeded, but a second factor is still required. */
  pendingMfa: boolean;
  login: (email: string, password: string) => Promise<'authenticated' | 'mfa'>;
  verifyMfa: (proof: MfaProof) => Promise<void>;
  cancelMfa: () => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingMfa, setPendingMfa] = useState(false);

  const clearAuthState = useCallback(() => {
    setUser(null);
    setIsAdmin(false);
    setSession(null);
    setPendingMfa(false);
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const me = await api.me();
      setUser(me.user);
      setIsAdmin(Boolean(me.isAdmin));
      setSession(me.session ?? null);
      setPendingMfa(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearAuthState();
      } else {
        clearAuthState();
      }
    }
  }, [clearAuthState]);

  useEffect(() => {
    let active = true;
    (async () => {
      await refreshSession();
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [refreshSession]);

  useEffect(() => {
    function onFocus() {
      if (user) void refreshSession();
    }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [user, refreshSession]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login(email, password);
    if (res.mfaRequired) {
      clearAuthState();
      setPendingMfa(true);
      return 'mfa';
    }
    setPendingMfa(false);
    setUser(res.user);
    setIsAdmin(Boolean(res.isAdmin));
    await refreshSession();
    return 'authenticated';
  }, [clearAuthState, refreshSession]);

  const verifyMfa = useCallback(async (proof: MfaProof) => {
    if (!pendingMfa) {
      throw new Error('No multi-factor authentication challenge is active.');
    }
    const { user: verifiedUser } = await api.verifyMfa(proof);
    setUser(verifiedUser);
    setPendingMfa(false);
    await refreshSession();
  }, [pendingMfa, refreshSession]);

  const register = useCallback(async (email: string, password: string) => {
    await api.register(email, password);
    clearAuthState();
  }, [clearAuthState]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      clearCsrfToken();
      clearAuthState();
    }
  }, [clearAuthState]);

  const cancelMfa = useCallback(async () => {
    await logout();
  }, [logout]);

  const value = useMemo(
    () => ({
      user,
      isAdmin,
      session,
      loading,
      pendingMfa,
      login,
      verifyMfa,
      cancelMfa,
      register,
      logout,
      refreshSession,
    }),
    [
      user,
      isAdmin,
      session,
      loading,
      pendingMfa,
      login,
      verifyMfa,
      cancelMfa,
      register,
      logout,
      refreshSession,
    ],
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
