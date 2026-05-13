"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter, usePathname } from "next/navigation";
import { api } from "@/lib/api/client";

interface UserInfo {
  id: number;
  username: string | null;
  email: string;
  name: string;
  role: string;
  status: string;
  grade: number | null;
  class_number: number | null;
  student_number: number | null;
  department: string | null;
  totp_enabled: boolean;
  must_change_password: boolean;
  permissions: string[];
}

interface AuthContextValue {
  user: UserInfo | null;
  loading: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => void;
  hasPermission: (permission: string) => boolean;
  isSuperAdmin: boolean;
  isDesignatedAdmin: boolean;
  isAdmin: boolean;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const PUBLIC_PATHS = ["/auth/login"];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const fetchUser = useCallback(async () => {
    try {
      const data = await api.get<UserInfo>("/api/auth/me");
      setUser(data);
      return data;
    } catch {
      setUser(null);
      api.clearTokens();
      return null;
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      const token = localStorage.getItem("access_token");
      if (token) {
        await fetchUser();
      }
      setLoading(false);
    };
    init();
  }, [fetchUser]);

  useEffect(() => {
    if (loading) return;
    const isPublic = PUBLIC_PATHS.some((p) => pathname?.startsWith(p));

    if (!user && !isPublic) {
      router.push("/auth/login");
    }

    if (user && pathname === "/auth/login") {
      // 역할에 따른 리다이렉트
      if (user.role === "student") {
        router.push("/s/dashboard");
      } else {
        router.push("/dashboard");
      }
    }

    // 비밀번호 변경 필요 시
    if (user?.must_change_password && pathname !== "/auth/change-password" && !isPublic) {
      // 첫 로그인 시 비밀번호 변경 유도 (나중에 구현)
    }
  }, [user, loading, pathname, router]);

  const login = useCallback(
    async (identifier: string, password: string) => {
      const data = await api.post("/api/auth/login", { identifier, password });
      localStorage.setItem("access_token", data.access_token);
      localStorage.setItem("refresh_token", data.refresh_token);
      setUser(data.user);
    },
    []
  );

  const logout = useCallback(() => {
    const refreshToken = localStorage.getItem("refresh_token");
    if (refreshToken) {
      api.post("/api/auth/logout", { refresh_token: refreshToken }).catch(() => {});
    }
    api.clearTokens();
    setUser(null);
    router.push("/auth/login");
  }, [router]);

  const hasPermission = useCallback(
    (permission: string) => {
      if (!user) return false;
      if (user.role === "super_admin") return true;
      if (user.role === "designated_admin") {
        // SUPER_ADMIN_ONLY는 프론트에서도 차단
        const superOnly = [
          "system.health.view", "system.logs.view", "system.backup.manage",
          "system.settings.edit", "system.feature_flags.manage", "system.audit.view",
          "permission.manage.view", "permission.manage.edit", "user.manage.delete",
        ];
        return !superOnly.includes(permission);
      }
      return user.permissions.includes(permission);
    },
    [user]
  );

  const value = useMemo(
    () => ({
      user,
      loading,
      login,
      logout,
      hasPermission,
      isSuperAdmin: user?.role === "super_admin",
      isDesignatedAdmin: user?.role === "designated_admin",
      isAdmin: user?.role === "super_admin" || user?.role === "designated_admin",
      refreshUser: fetchUser as () => Promise<void>,
    }),
    [user, loading, login, logout, hasPermission, fetchUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
