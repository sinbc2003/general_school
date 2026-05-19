"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api/client";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [canRegister, setCanRegister] = useState(false);

  useEffect(() => {
    api.get("/api/auth/bootstrap-status")
      .then((d) => setCanRegister(!!d.can_register))
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await login(identifier, password);
      if (result.type === "challenge") {
        // 이메일 코드 발송됨 — 코드 입력 페이지로
        // dev_code (SMTP 미설정 dev 환경에서만 backend가 노출)는 verify-email 페이지에서 표시.
        sessionStorage.setItem("login_challenge", JSON.stringify({
          challenge_token: result.challenge_token,
          email_masked: result.email_masked,
          expires_in_minutes: result.expires_in_minutes,
          issued_at: Date.now(),
          dev_code: result.dev_code ?? null,
        }));
        router.push("/auth/verify-email");
        return;
      }
      // type === 'token' — AuthProvider가 redirect 처리
    } catch (err: any) {
      setError(err?.detail || "로그인에 실패했습니다");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-secondary">
      <div className="w-full max-w-sm bg-bg-primary rounded-lg shadow-lg p-8">
        <div className="text-center mb-8">
          <h1 className="text-title text-text-primary">학교 통합 플랫폼</h1>
          <p className="text-caption text-text-tertiary mt-1">
            로그인하여 시작하세요
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-caption text-text-secondary mb-1">
              이메일 또는 아이디
            </label>
            <input
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className="w-full px-3 py-2 border border-border-default rounded bg-bg-primary text-text-primary focus:outline-none focus:border-accent"
              placeholder="이메일 또는 아이디"
              required
            />
          </div>

          <div>
            <label className="block text-caption text-text-secondary mb-1">
              비밀번호
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-border-default rounded bg-bg-primary text-text-primary focus:outline-none focus:border-accent"
              placeholder="비밀번호"
              required
            />
          </div>

          {error && (
            <div className="text-caption text-status-error bg-red-50 p-2 rounded">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-accent text-white rounded font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            {loading ? "로그인 중..." : "로그인"}
          </button>
        </form>

        {canRegister && (
          <div className="mt-6 pt-4 border-t border-border-default text-center">
            <p className="text-caption text-text-tertiary mb-2">
              아직 등록된 사용자가 없습니다.
            </p>
            <Link
              href="/auth/register"
              className="inline-block text-body text-accent hover:underline font-medium"
            >
              첫 가입자(최고관리자) 등록하기 →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
