"use client";

/**
 * 초기 비밀번호 변경 페이지
 *
 * CSV import로 등록된 사용자는 phone이 초기 비밀번호이고 must_change_password=True.
 * 로그인 후 AuthProvider가 이 페이지로 강제 리다이렉트하며, 변경 완료 시 본래 흐름 재개.
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, AlertCircle, Check } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAuth } from "@/lib/auth-context";

interface PasswordPolicy {
  min_length: number;
  require_letter: boolean;
  require_digit: boolean;
  require_symbol: boolean;
  rules: string[];
}

export default function ChangePasswordPage() {
  const router = useRouter();
  const { user, refreshUser } = useAuth();
  const [current, setCurrent] = useState("");
  const [next1, setNext1] = useState("");
  const [next2, setNext2] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [policy, setPolicy] = useState<PasswordPolicy | null>(null);

  useEffect(() => {
    api.get<PasswordPolicy>("/api/auth/password-policy")
      .then(setPolicy)
      .catch(() => null);
  }, []);

  // 클라이언트 사이드 정책 체크 (실시간 피드백) — 서버에서도 검증함
  const checkRules = (pw: string) => {
    if (!policy) return [];
    const checks: Array<{ ok: boolean; label: string }> = [];
    checks.push({ ok: pw.length >= policy.min_length, label: `최소 ${policy.min_length}자 이상` });
    if (policy.require_letter) checks.push({ ok: /[A-Za-z]/.test(pw), label: "영문자 포함" });
    if (policy.require_digit) checks.push({ ok: /\d/.test(pw), label: "숫자 포함" });
    if (policy.require_symbol) checks.push({ ok: /[^A-Za-z0-9\s]/.test(pw), label: "특수문자 포함" });
    return checks;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (next1 !== next2) {
      setError("새 비밀번호 확인이 일치하지 않습니다.");
      return;
    }
    if (next1 === current) {
      setError("새 비밀번호가 현재 비밀번호와 같습니다.");
      return;
    }
    // 클라이언트 사이드 빠른 차단 (서버에서도 검증)
    const failed = checkRules(next1).filter((c) => !c.ok);
    if (failed.length > 0) {
      setError(failed.map((c) => c.label).join(" · "));
      return;
    }
    setLoading(true);
    try {
      await api.post("/api/auth/change-password", {
        current_password: current,
        new_password: next1,
      });
      await refreshUser();
      // 역할에 따라 적절한 페이지로
      if (user?.role === "student") {
        router.push("/s/dashboard");
      } else {
        router.push("/dashboard");
      }
    } catch (err: any) {
      setError(err?.detail || "비밀번호 변경 실패");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-secondary p-4">
      <div className="w-full max-w-md bg-bg-primary rounded-lg shadow-lg p-8">
        <div className="text-center mb-6">
          <KeyRound size={32} className="mx-auto text-accent mb-2" />
          <h1 className="text-title text-text-primary">비밀번호 변경</h1>
          <p className="text-caption text-text-tertiary mt-1">
            첫 로그인입니다. 안전을 위해 비밀번호를 변경해주세요.
          </p>
        </div>

        {user?.must_change_password && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded text-caption text-amber-800 flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
            <span>
              초기 비밀번호(휴대폰 번호)는 안전하지 않습니다. 변경하지 않으면 다른 페이지를 이용할 수 없습니다.
            </span>
          </div>
        )}

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-caption text-text-secondary mb-1">
              현재 비밀번호 *
            </label>
            <input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
              autoFocus
              placeholder="초기 비밀번호(휴대폰 번호 숫자만)"
              className="w-full px-3 py-2 border border-border-default rounded bg-bg-primary"
            />
          </div>
          <div>
            <label className="block text-caption text-text-secondary mb-1">
              새 비밀번호 *
              {policy && (
                <span className="text-text-tertiary ml-1">({policy.rules.join(" · ")})</span>
              )}
            </label>
            <input
              type="password"
              value={next1}
              onChange={(e) => setNext1(e.target.value)}
              required
              minLength={policy?.min_length || 8}
              className="w-full px-3 py-2 border border-border-default rounded bg-bg-primary"
            />
            {policy && next1 && (
              <div className="mt-1.5 flex flex-wrap gap-2 text-caption">
                {checkRules(next1).map((c, i) => (
                  <span
                    key={i}
                    className={`inline-flex items-center gap-1 ${
                      c.ok ? "text-accent" : "text-text-tertiary"
                    }`}
                  >
                    {c.ok ? <Check size={12} /> : "·"} {c.label}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="block text-caption text-text-secondary mb-1">새 비밀번호 확인 *</label>
            <input
              type="password"
              value={next2}
              onChange={(e) => setNext2(e.target.value)}
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
            {loading ? "변경 중..." : "비밀번호 변경"}
          </button>
        </form>
      </div>
    </div>
  );
}
