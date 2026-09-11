"use client";

import { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { api, SESSION_EXPIRED_EVENT } from "@/lib/api";

type AuthContextValue = {
  user: any | null;
  entitlements: any | null;
  counts: any | null;
  loading: boolean;
  mounted: boolean; // True after client hydration - use this to prevent hydration mismatch
  isAuthenticated: boolean;
  isPro: boolean;
  sessionExpired: boolean;
  refreshUser: () => Promise<void>;
  signOut: () => Promise<void>;
  handleSessionExpiry: () => void;
  dismissSessionExpiry: () => void;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  entitlements: null,
  counts: null,
  loading: true,
  mounted: false,
  isAuthenticated: false,
  isPro: false,
  sessionExpired: false,
  refreshUser: async () => {},
  signOut: async () => {},
  handleSessionExpiry: () => {},
  dismissSessionExpiry: () => {},
});

const LS_USER = "evi_auth_user";
const LS_ENT = "evi_auth_entitlements";
const LS_COUNTS = "evi_auth_counts";
const AUTH_COOKIE = "evi_app_auth";
const SESSION_EXPIRED_COOLDOWN_MS = 5000; // Don't show session expired more than once per 5 seconds

function setAuthCookie(val: "1" | "0") {
  if (typeof document === "undefined") return;
  const maxAge = val === "1" ? 60 * 60 * 24 * 30 : 0; // 30 days or expire
  document.cookie = `${AUTH_COOKIE}=${val}; path=/; max-age=${maxAge}; SameSite=Lax`;
}

function clearAuthCookie() {
  if (typeof document === "undefined") return;
  document.cookie = `${AUTH_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}

// Get state from localStorage (only call after mount)
function getStoredState<T>(key: string): T | null {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  // Start with null to match server render - hydrate from localStorage in useEffect
  const [user, setUser] = useState<any | null>(null);
  const [entitlements, setEntitlements] = useState<any | null>(null);
  const [counts, setCounts] = useState<any | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [mounted, setMounted] = useState<boolean>(false); // Track client mount for hydration
  const [sessionExpired, setSessionExpired] = useState<boolean>(false);
  const lastSessionExpiredRef = useRef<number>(0);
  const isRefreshingRef = useRef<boolean>(false);

  // Handle session expiry - called when 401 is received
  // Directly redirect to signin instead of showing modal
  const handleSessionExpiry = useCallback(() => {
    const now = Date.now();
    // Don't redirect if we're currently refreshing or redirected recently
    if (isRefreshingRef.current) return;
    if (now - lastSessionExpiredRef.current < SESSION_EXPIRED_COOLDOWN_MS) return;
    lastSessionExpiredRef.current = now;
    // Clear user state
    setUser(null);
    setEntitlements(null);
    setCounts(null);
    clearAuthCookie();
    try {
      if (typeof window !== "undefined") {
        localStorage.removeItem(LS_USER);
        localStorage.removeItem(LS_ENT);
        localStorage.removeItem(LS_COUNTS);
      }
    } catch {}
    // Redirect to signin with current path as redirect
    const currentPath = window.location.pathname;
    const redirectParam = currentPath && currentPath !== '/' && currentPath !== '/signin' && currentPath !== '/signup'
      ? `?redirect=${encodeURIComponent(currentPath)}`
      : '';
    router.push(`/signin${redirectParam}`);
  }, [router]);

  const dismissSessionExpiry = useCallback(() => {
    setSessionExpired(false);
  }, []);

  // Listen for global session expired events from API client
  useEffect(() => {
    const handleSessionExpiredEvent = () => {
      handleSessionExpiry();
    };

    if (typeof window !== "undefined") {
      window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpiredEvent);
      return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpiredEvent);
    }
  }, [handleSessionExpiry]);

  // Initial auth check - only runs once on mount
  useEffect(() => {
    let isMounted = true;

    // Mark as mounted immediately to prevent hydration mismatch
    setMounted(true);

    // Hydrate from localStorage first for immediate UI update
    const cachedUser = getStoredState<any>(LS_USER);
    const cachedEnt = getStoredState<any>(LS_ENT);
    const cachedCounts = getStoredState<any>(LS_COUNTS);
    if (cachedUser) {
      setUser(cachedUser);
      setEntitlements(cachedEnt);
      setCounts(cachedCounts);
    }

    (async () => {
      isRefreshingRef.current = true;
      try {
        // Skip auth check for demo mode - webbuilder backend doesn't have user management
        // try { await (api as any).refresh?.(); } catch {}
        // const me = await (api as any).meCached?.({ forceRefresh: true }) ?? await api.me();
        // if (!isMounted) return;

        // const u = (me as any).user ?? null;
        // const en = (me as any).entitlements ?? null;
        // const c = (me as any).counts ?? null;
        const u = null;
        const en = null;
        const c = null;
        setUser(u);
        setEntitlements(en);
        setCounts(c);
        setAuthCookie("1");
        // Clear any session expired state on successful auth
        setSessionExpired(false);
        try {
          localStorage.setItem(LS_USER, JSON.stringify(u ?? null));
          localStorage.setItem(LS_ENT, JSON.stringify(en ?? null));
          localStorage.setItem(LS_COUNTS, JSON.stringify(c ?? null));
        } catch {}
      } catch (err) {
        if (!isMounted) return;
        // Only clear state if we don't have any cached user
        const hasLocalUser = !!getStoredState(LS_USER);
        if (!hasLocalUser) {
          setUser(null);
          setEntitlements(null);
          setCounts(null);
          clearAuthCookie();
          try {
            localStorage.removeItem(LS_USER);
            localStorage.removeItem(LS_ENT);
            localStorage.removeItem(LS_COUNTS);
          } catch {}
        }
        // Only redirect if on protected route AND no cached user
        const isProtectedRoute = pathname?.startsWith("/chat") || pathname?.startsWith("/profile") || pathname?.startsWith("/projects") || pathname === "/subscription";
        if (isProtectedRoute && !hasLocalUser) {
          router.push("/signin");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
          isRefreshingRef.current = false;
        }
      }
    })();

    return () => { isMounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  const isAuthenticated = !!user;
  const isPro = useMemo(() => {
    const e = entitlements as any;
    const u = user as any;
    return !!(e?.pro_enabled || e?.pro || e?.isPro || e?.plan === "pro" || e?.tier === "pro" || u?.role === "pro" || u?.role === "admin");
  }, [entitlements, user]);

  const refreshUser = async () => {
    isRefreshingRef.current = true;
    try {
      try { await (api as any).refresh?.(); } catch {}
      const me = await (api as any).meCached?.({ forceRefresh: true }) ?? await api.me();
      const u = (me as any).user ?? null;
      const en = (me as any).entitlements ?? null;
      const c = (me as any).counts ?? null;
      setUser(u);
      setEntitlements(en);
      setCounts(c);
      setAuthCookie("1");
      setSessionExpired(false); // Clear session expired on successful refresh
      try {
        if (typeof window !== "undefined") {
          localStorage.setItem(LS_USER, JSON.stringify(u ?? null));
          localStorage.setItem(LS_ENT, JSON.stringify(en ?? null));
          localStorage.setItem(LS_COUNTS, JSON.stringify(c ?? null));
        }
      } catch {}
    } finally {
      isRefreshingRef.current = false;
    }
  };

  const signOut = async () => {
    try { await api.logout(); } catch {}
    setUser(null);
    setEntitlements(null);
    setCounts(null);
    clearAuthCookie();
    try {
      if (typeof window !== "undefined") {
        localStorage.removeItem(LS_USER);
        localStorage.removeItem(LS_ENT);
        localStorage.removeItem(LS_COUNTS);
      }
    } catch {}
    router.push("/signin");
  };

  const value: AuthContextValue = {
    user,
    entitlements,
    counts,
    loading,
    mounted,
    isAuthenticated,
    isPro,
    sessionExpired,
    refreshUser,
    signOut,
    handleSessionExpiry,
    dismissSessionExpiry,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
