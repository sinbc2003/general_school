"use client";

/**
 * 로그인 2단계 — 이메일 코드 검증.
 *
 * 흐름:
 * 1. /auth/login에서 비밀번호 통과 후 type='challenge' 응답
 * 2. sessionStorage에 challenge_token + email_masked 저장 + 이 페이지로 redirect
 * 3. 사용자가 이메일 받은 6자리 코드 입력
 * 4. (선택) '이 장치 기억 30일' 체크 → 새 신뢰 장치 등록 + cookie
 * 5. 검증 성공 → 토큰 저장 → /dashboard
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, RefreshCw, AlertCircle, KeyRound, ArrowLeft } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api/client";

interface ChallengeInfo {
  challenge_token: string;
  email_masked: string;
  expires_in_minutes: number;
  issued_at: number;
}

export default function VerifyEmailPage() {
  const router = useRouter();
  const { completeChallenge } = useAuth();
  const [challenge, setChallenge] = useState<ChallengeInfo | null>(null);
  const [code, setCode] = useState("");
  const [rememberDevice, setRememberDevice] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // sessionStorage에서 challenge 불러오기. 없으면 login으로 돌려보냄.
  useEffect(() => {
    const raw = sessionStorage.getItem("login_challenge");
    if (!raw) {
      router.replace("/auth/login");
      return;
    }
    try {
      const data = JSON.parse(raw) as ChallengeInfo;
      // 만료 체크
      const elapsedMs = Date.now() - data.issued_at;
      const expiryMs = data.expires_in_minutes * 60 * 1000;
      if (elapsedMs > expiryMs) {
        sessionStorage.removeItem("login_challenge");
        router.replace("/auth/login");
        return;
      }
      setChallenge(data);
    } catch {
      sessionStorage.removeItem("login_challenge");
      router.replace("/auth/login");
    }
  }, [router]);

  // 자동 포커스
  useEffect(() => {
    if (challenge) inputRef.current?.focus();
  }, [challenge]);

  // 재발송 쿨다운 카운트다운
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!challenge) return;
    const clean = code.replace(/\s/g, "");
    if (clean.length !== 6) {
      setError("6자리 코드를 입력하세요.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      await completeChallenge(challenge.challenge_token, clean, rememberDevice);
      sessionStorage.removeItem("login_challenge");
      router.push("/dashboard");
    } catch (err: any) {
      setError(err?.detail || "코드 검증 실패");
    } finally {
      setSubmitting(false);
    }
  };

  const resend = async () => {
    if (!challenge || resendCooldown > 0) return;
    setResending(true);
    setError("");
    try {
      await api.post("/api/auth/login/resend-email", {
        challenge_token: challenge.challenge_token,
      });
      // 쿨다운 60초
      setResendCooldown(60);
      // 시간 카운트 재시작
      setChallenge({ ...challenge, issued_at: Date.now() });
    } catch (err: any) {
      setError(err?.detail || "재발송 실패");
    } finally {
      setResending(false);
    }
  };

  const goBack = () => {
    sessionStorage.removeItem("login_challenge");
    router.push("/auth/login");
  };

  if (!challenge) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-secondary">
        <div className="text-text-tertiary">로딩 중...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-secondary p-4">
      <div className="bg-bg-primary border border-border-default rounded-lg shadow-sm w-full max-w-md p-6">
        <div className="flex items-center gap-2 mb-3">
          <Mail size={22} className="text-accent" />
          <h1 className="text-title text-text-primary">이메일 확인</h1>
        </div>
        <p className="text-caption text-text-secondary mb-1">
          <b>{challenge.email_masked}</b> 로 6자리 인증 코드를 보냈습니다.
        </p>
        <p className="text-caption text-text-tertiary mb-5">
          이메일 받은편지함을 확인하세요. ({challenge.expires_in_minutes}분 내 유효)
        </p>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-caption text-text-secondary mb-1">
              <KeyRound size={12} className="inline mr-1" />
              인증 코드
            </label>
            <input
              ref={inputRef}
              type="text"
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/[^\d ]/g, "").slice(0, 7))
              }
              inputMode="numeric"
              pattern="[0-9]{6}"
              placeholder="123 456"
              className="w-full px-3 py-3 text-title text-center font-mono tracking-widest border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent"
            />
          </div>

          <label className="flex items-start gap-2 cursor-pointer p-2 rounded hover:bg-bg-secondary">
            <input
              type="checkbox"
              checked={rememberDevice}
              onChange={(e) => setRememberDevice(e.target.checked)}
              className="mt-1"
            />
            <div className="flex-1">
              <div className="text-body text-text-primary">이 장치 30일간 기억</div>
              <div className="text-caption text-text-tertiary">
                개인 노트북에서만 켜세요. <b>공용 PC에서는 절대 켜지 마세요.</b>
              </div>
            </div>
          </label>

          {error && (
            <div className="flex items-start gap-2 text-caption text-status-error p-2 bg-red-50 border border-red-200 rounded">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || code.length < 6}
            className="w-full py-2.5 bg-accent text-white rounded font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            {submitting ? "확인 중..." : "확인 후 로그인"}
          </button>

          <div className="flex items-center justify-between text-caption">
            <button
              type="button"
              onClick={goBack}
              className="flex items-center gap-1 text-text-tertiary hover:text-accent"
            >
              <ArrowLeft size={12} /> 다른 계정으로
            </button>
            <button
              type="button"
              onClick={resend}
              disabled={resending || resendCooldown > 0}
              className="flex items-center gap-1 text-text-tertiary hover:text-accent disabled:opacity-50"
            >
              <RefreshCw size={12} className={resending ? "animate-spin" : ""} />
              {resendCooldown > 0 ? `재발송 (${resendCooldown}s)` : "코드 재발송"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
