"use client";

/**
 * 관리자 2FA 강제 등록 페이지.
 *
 * 흐름:
 * 1. /api/auth/2fa/setup 호출 → secret + qr_code(base64) 받음
 * 2. 사용자가 인증 앱(Google Authenticator 등)에 QR 스캔
 * 3. 앱의 6자리 코드 입력 → /api/auth/2fa/confirm 호출 (X-TOTP-Secret 헤더로 secret 전달)
 * 4. 성공 시 refreshUser → must_enable_2fa false → 본래 흐름으로
 *
 * 정책이 admin 2FA 필수일 때 AuthProvider가 이 페이지로 강제 redirect.
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, AlertCircle, Loader2, Copy, Check } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8002";

export default function TwoFaSetupPage() {
  const router = useRouter();
  const { user, refreshUser } = useAuth();

  const [secret, setSecret] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);

  // 페이지 진입 시 secret + QR 발급
  useEffect(() => {
    if (!user) return;
    if (user.totp_enabled) {
      // 이미 등록됨 — 본래 페이지로
      router.push("/dashboard");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = localStorage.getItem("access_token");
        const res = await fetch(`${API_URL}/api/auth/2fa/setup`, {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.detail || "설정 시작 실패");
        if (cancelled) return;
        setSecret(data.secret);
        setQrCode(data.qr_code);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "2FA 설정 시작 실패");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, router]);

  const copySecret = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (code.replace(/\s/g, "").length !== 6) {
      setError("6자리 인증 코드를 입력하세요.");
      return;
    }
    setConfirming(true);
    try {
      const token = localStorage.getItem("access_token");
      const res = await fetch(`${API_URL}/api/auth/2fa/confirm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "X-TOTP-Secret": secret,
        },
        body: JSON.stringify({ code: code.replace(/\s/g, "") }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "인증 실패");
      await refreshUser();
      router.push("/dashboard");
    } catch (err: any) {
      setError(err?.message || "인증 실패. 코드를 다시 확인하세요.");
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-secondary p-4">
      <div className="bg-bg-primary border border-border-default rounded-lg shadow-sm w-full max-w-md p-6">
        <div className="flex items-center gap-2 mb-4">
          <ShieldCheck size={22} className="text-accent" />
          <h1 className="text-title text-text-primary">2FA 등록 필요</h1>
        </div>
        <p className="text-caption text-text-secondary mb-5">
          학교 정책상 <b>{user?.role === "super_admin" ? "최고관리자" : "지정관리자"}</b>는
          2단계 인증 등록이 필수입니다. 등록을 완료하면 본래 페이지로 이동합니다.
        </p>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-text-tertiary">
            <Loader2 className="animate-spin mr-2" size={18} /> 설정 시작 중...
          </div>
        ) : (
          <form onSubmit={confirm} className="space-y-4">
            {qrCode && (
              <div>
                <div className="text-caption text-text-secondary mb-2">
                  1. <b>인증 앱(Google Authenticator, Authy, 1Password 등)</b>에서 아래 QR을 스캔
                </div>
                <div className="flex justify-center bg-white p-3 rounded border border-border-default">
                  {/* base64 QR — img src */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`data:image/png;base64,${qrCode}`}
                    alt="2FA QR Code"
                    className="w-44 h-44"
                  />
                </div>
              </div>
            )}

            {secret && (
              <div>
                <div className="text-caption text-text-secondary mb-1">
                  QR 스캔 불가 시 아래 키를 수동 입력
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-caption font-mono px-3 py-1.5 bg-bg-secondary border border-border-default rounded break-all">
                    {secret}
                  </code>
                  <button
                    type="button"
                    onClick={copySecret}
                    className="p-1.5 hover:bg-bg-secondary rounded text-text-tertiary"
                    title="복사"
                  >
                    {copied ? <Check size={14} className="text-accent" /> : <Copy size={14} />}
                  </button>
                </div>
              </div>
            )}

            <div>
              <label className="block text-caption text-text-secondary mb-1">
                2. 앱에 표시된 <b>6자리 코드 입력</b>
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, "").slice(0, 7))}
                inputMode="numeric"
                pattern="[0-9]{6}"
                placeholder="123 456"
                autoFocus
                className="w-full px-3 py-2 text-title text-center font-mono tracking-widest border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 text-caption text-status-error p-2 bg-red-50 border border-red-200 rounded">
                <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={confirming || code.length < 6}
              className="w-full px-4 py-2 text-body bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
            >
              {confirming ? "확인 중..." : "등록 완료"}
            </button>

            <div className="text-caption text-text-tertiary text-center">
              ⚠ 이 화면을 떠나면 다시 등록해야 합니다. 등록 후 인증 앱은 분실에 주의하세요.
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
