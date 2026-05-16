import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { api, ApiError, tokenStorage } from "./api";

interface User {
  id: string;
  email: string;
  display_name: string | null;
  username?: string | null;
  bio?: string | null;
  avatar_file_id?: string | null;
  public_profile?: boolean;
  is_admin?: boolean;
  /** Set once the user clicks "don't show again" on the onboarding
   *  modal. NULL → modal auto-opens at session start. */
  onboarding_dismissed_at?: string | null;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  signOut: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!tokenStorage.get()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      setUser(await api.me());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        tokenStorage.clear();
      }
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { access_token } = await api.login(email, password);
    tokenStorage.set(access_token);
    setUser(await api.me());
  }, []);

  const signUp = useCallback(async (email: string, password: string, displayName?: string) => {
    const { access_token } = await api.register(email, password, displayName);
    tokenStorage.set(access_token);
    setUser(await api.me());
  }, []);

  const signOut = useCallback(() => {
    tokenStorage.clear();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, signIn, signUp, signOut, refreshUser: refresh }),
    [user, loading, signIn, signUp, signOut, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
