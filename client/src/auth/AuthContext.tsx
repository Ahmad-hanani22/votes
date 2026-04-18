import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import api, { setAuthToken } from "../api/client";

export type Role = "admin" | "staff";

export type AuthUser = { id: number; username: string; role: Role };

type AuthState = {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

const STORAGE_KEY = "vms_token";

function readStoredToken(): string | null {
  try {
    localStorage.removeItem(STORAGE_KEY);
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => readStoredToken());
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setAuthToken(null);
      setUser(null);
      setLoading(false);
      return;
    }
    setAuthToken(token);
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get<AuthUser>("/auth/me");
        if (!cancelled) setUser(data);
      } catch {
        if (!cancelled) {
          setUser(null);
          setToken(null);
          sessionStorage.removeItem(STORAGE_KEY);
          setAuthToken(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const login = useCallback(async (username: string, password: string) => {
    const { data } = await api.post<{ token: string; user: AuthUser }>("/auth/login", {
      username,
      password,
    });
    sessionStorage.setItem(STORAGE_KEY, data.token);
    setAuthToken(data.token);
    setToken(data.token);
    setUser(data.user);
  }, []);

  const logout = useCallback(() => {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setAuthToken(null);
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, token, loading, login, logout }),
    [user, token, loading, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside provider");
  return ctx;
}
