"use client";

/**
 * 첫 가입자 등록 페이지 (OpenWebUI 방식)
 * - User count == 0이고 BOOTSTRAP_MODE=first_signup 일 때만 동작
 * - 가입 즉시 super_admin 권한 + 자동 로그인
 * - 이후 추가 사용자는 최고관리자가 /users 페이지에서 CSV 업로드
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Shield, AlertCircle, ArrowLeft } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8002";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [info, setInfo] = useState<{ user_count: number; bootstrap_mode: string } | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/api/auth/bootstrap-status`)
      .then((r) => r.json())
      .then((d) => {
        setAllowed(!!d.can_register);
        setInfo(d);
      })
      .catch(() => setAllowed(false));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("비밀번호는 8자 이상이어야 합니다.");
      return;
    }
    if (password !== pw2) {
      setError("비밀번호 확인이 일치하지 않습니다.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.detail || "가입 실패");
      }
      // 자동 로그인 토큰 저장
      localStorage.setItem("access_token", data.access_token);
      localStorage.setItem("refresh_token", data.refresh_token);
      router.push("/dashboard");
      // 컨텍스트 갱신을 위해 새로고침
      setTimeout(() => window.location.reload(), 100);
    } catch (err: any) {
      setError(err?.message || "가입 실패");
    } finally {
      setLoading(false);
    }
  };

  if (allowed === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-secondary text-text-secondary">
        확인 중...
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-secondary p-4">
        <div className="w-full max-w-md bg-bg-primary rounded-lg shadow-lg p-8 text-center">
          <AlertCircle size={36} className="mx-auto text-status-warning mb-3" />
          <h1 className="text-title text-text-primary mb-2">가입 차단됨</h1>
          <p className="text-body text-text-secondary mb-1">
            {info && info.user_count > 0
              ? "이미 사용자가 등록되어 있습니다."
              : "회원가입이 비활성화되어 있습니다."}
          </p>
          <p className="text-caption text-text-tertiary mb-6">
            추가 사용자는 최고관리자가 직접 등록(CSV 업로드)해야 합니다.
            계정이 필요하면 학교 관리자에게 요청하세요.
          </p>
          <Link
            href="/auth/login"
            className="inline-flex items-center gap-1 text-accent hover:underline"
          >
            <ArrowLeft size={14} /> 로그인 페이지로
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-secondary p-4">
      <div className="w-full max-w-md bg-bg-primary rounded-lg shadow-lg p-8">
        <div className="text-center mb-6">
          <Shield size={32} className="mx-auto text-accent mb-2" />
          <h1 className="text-title text-text-primary">최고관리자 가입</h1>
          <p className="text-caption text-text-tertiary mt-1">
            첫 가입자가 자동으로 최고관리자가 됩니다.
            <br />이후 추가 사용자는 CSV 업로드로 등록합니다.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-caption text-text-secondary mb-1">이름 *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-3 py-2 border border-border-default rounded bg-bg-primary"
              placeholder="홍길동"
            />
          </div>
          <div>
            <label className="block text-caption text-text-secondary mb-1">이메일 *</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 border border-border-default rounded bg-bg-primary"
              placeholder="admin@school.local"
            />
          </div>
          <div>
            <label className="block text-caption text-text-secondary mb-1">아이디 *</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="w-full px-3 py-2 border border-border-default rounded bg-bg-primary"
              placeholder="admin"
            />
          </div>
          <div>
            <label className="block text-caption text-text-secondary mb-1">
              비밀번호 * <span className="text-text-tertiary">(8자 이상)</span>
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full px-3 py-2 border border-border-default rounded bg-bg-primary"
            />
          </div>
          <div>
            <label className="block text-caption text-text-secondary mb-1">비밀번호 확인 *</label>
            <input
              type="password"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              required
              className="w-full px-3 py-2 border border-border-default rounded bg-bg-primary"
            />
          </div>

          {error && (
            <div className="text-caption text-status-error bg-red-50 p-2 rounded">{error}</div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-accent text-white rounded font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors mt-2"
          >
            {loading ? "가입 중..." : "최고관리자로 가입하기"}
          </button>
        </form>
      </div>
    </div>
  );
}
