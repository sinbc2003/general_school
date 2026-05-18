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
  // admin 2FA 강제 정책 ON + admin role + 2FA 미등록이면 True
  must_enable_2fa?: boolean;
  permissions: string[];
}

export type LoginResult =
  | { type: "token" }
  | {
      type: "challenge";
      challenge_token: string;
      email_masked: string;
      expires_in_minutes: number;
    };

interface AuthContextValue {
  user: UserInfo | null;
  loading: boolean;
  login: (identifier: string, password: string) => Promise<LoginResult>;
  completeChallenge: (
    challenge_token: string, code: string, remember_device: boolean,
  ) => Promise<void>;
  logout: () => void;
  hasPermission: (permission: string) => boolean;
  isSuperAdmin: boolean;
  isDesignatedAdmin: boolean;
  isAdmin: boolean;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const PUBLIC_PATHS = ["/auth/login", "/auth/register"];
const PASSWORD_CHANGE_PATH = "/auth/change-password";
const ONBOARDING_PATH = "/auth/teacher-onboarding";
const TWOFA_SETUP_PATH = "/auth/2fa-setup";

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

  // 교사 onboarding 필요 여부 (현재 학기 enrollment.onboarded=false)
  const [needsTeacherOnboarding, setNeedsTeacherOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    // 교사만 onboarding 체크. 다른 역할은 skip.
    if (!user || user.role !== "teacher" || user.must_change_password) {
      setNeedsTeacherOnboarding(false);
      return;
    }
    api
      .get<{ enrollment: { onboarded: boolean } | null }>("/api/timetable/my-enrollment")
      .then((d) => setNeedsTeacherOnboarding(!!d.enrollment && !d.enrollment.onboarded))
      .catch(() => setNeedsTeacherOnboarding(false));
  }, [user]);

  useEffect(() => {
    if (loading) return;
    const isPublic = PUBLIC_PATHS.some((p) => pathname?.startsWith(p));
    const isPasswordChange = pathname?.startsWith(PASSWORD_CHANGE_PATH);
    const isOnboarding = pathname?.startsWith(ONBOARDING_PATH);
    const is2faSetup = pathname?.startsWith(TWOFA_SETUP_PATH);

    // 비로그인 + 비공개 페이지 → 로그인으로
    if (!user && !isPublic && !isPasswordChange && !isOnboarding && !is2faSetup) {
      router.push("/auth/login");
      return;
    }

    // 로그인 상태인데 must_change_password=True → 비밀번호 변경 강제
    if (user?.must_change_password && !isPasswordChange) {
      router.push(PASSWORD_CHANGE_PATH);
      return;
    }

    // admin 2FA 강제 정책 ON + 미등록 → 2FA 등록 페이지로
    if (user?.must_enable_2fa && !is2faSetup && !isPasswordChange) {
      router.push(TWOFA_SETUP_PATH);
      return;
    }

    // 교사 + onboarding 필요 → onboarding 페이지로
    if (user?.role === "teacher" && needsTeacherOnboarding && !isOnboarding && !isPasswordChange) {
      router.push(ONBOARDING_PATH);
      return;
    }

    // 이미 로그인 + 로그인 페이지에 있음 → 통합 대시보드로
    if (user && pathname === "/auth/login") {
      router.push("/dashboard");
    }
  }, [user, loading, pathname, router, needsTeacherOnboarding]);

  const login = useCallback(
    async (identifier: string, password: string): Promise<LoginResult> => {
      const data = await api.post("/api/auth/login", { identifier, password });
      if (data.type === "challenge") {
        return {
          type: "challenge",
          challenge_token: data.challenge_token,
          email_masked: data.email_masked,
          expires_in_minutes: data.expires_in_minutes,
        };
      }
      // type === 'token' (학생 / 신뢰 장치 매칭)
      localStorage.setItem("access_token", data.access_token);
      localStorage.setItem("refresh_token", data.refresh_token);
      setUser(data.user);
      return { type: "token" };
    },
    []
  );

  const completeChallenge = useCallback(
    async (challenge_token: string, code: string, remember_device: boolean) => {
      const data = await api.post("/api/auth/login/verify-email", {
        challenge_token,
        code,
        remember_device,
      });
      // verify-email은 항상 type='token' (실패는 throw)
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
      completeChallenge,
      logout,
      hasPermission,
      isSuperAdmin: user?.role === "super_admin",
      isDesignatedAdmin: user?.role === "designated_admin",
      isAdmin: user?.role === "super_admin" || user?.role === "designated_admin",
      refreshUser: fetchUser as () => Promise<void>,
    }),
    [user, loading, login, completeChallenge, logout, hasPermission, fetchUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
