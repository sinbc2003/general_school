"use client";

/**
 * 초기 비밀번호 변경 페이지
 *
 * CSV import로 등록된 사용자는 phone이 초기 비밀번호이고 must_change_password=True.
 * 로그인 후 AuthProvider가 이 페이지로 강제 리다이렉트하며, 변경 완료 시 본래 흐름 재개.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, AlertCircle } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAuth } from "@/lib/auth-context";

export default function ChangePasswordPage() {
  const router = useRouter();
  const { user, refreshUser } = useAuth();
  const [current, setCurrent] = useState("");
  const [next1, setNext1] = useState("");
  const [next2, setNext2] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (next1.length < 8) {
      setError("새 비밀번호는 8자 이상이어야 합니다.");
      return;
    }
    if (next1 !== next2) {
      setError("새 비밀번호 확인이 일치하지 않습니다.");
      return;
    }
    if (next1 === current) {
      setError("새 비밀번호가 현재 비밀번호와 같습니다.");
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
              새 비밀번호 * <span className="text-text-tertiary">(8자 이상)</span>
            </label>
            <input
              type="password"
              value={next1}
              onChange={(e) => setNext1(e.target.value)}
              required
              minLength={8}
              className="w-full px-3 py-2 border border-border-default rounded bg-bg-primary"
            />
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
