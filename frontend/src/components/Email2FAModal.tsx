"use client";

/**
 * 민감데이터 접근 시 이메일 코드 2차 인증 모달.
 *
 * client.ts가 403 {code:"2FA_REQUIRED"} 응답을 받으면 전역 이벤트 `gs:2fa-required`를
 * 디스패치한다. 이 모달이 그걸 받아 이메일 코드 발송→입력→검증을 처리하고,
 * 성공하면 페이지를 새로고침해 원래 요청을 다시 시도한다.
 * (인증앱 불필요 — 이메일로만 인증)
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";

export default function Email2FAModal() {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<"prompt" | "code">("prompt");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [challenge, setChallenge] = useState("");
  const [emailMasked, setEmailMasked] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("gs:2fa-required", handler);
    return () => window.removeEventListener("gs:2fa-required", handler);
  }, []);

  if (!open) return null;

  const close = () => {
    setOpen(false);
    setStage("prompt"); setChallenge(""); setEmailMasked(""); setDevCode(null);
    setCode(""); setError(null); setSending(false); setVerifying(false);
  };

  const sendCode = async () => {
    setSending(true); setError(null);
    try {
      const r: any = await api.post("/api/auth/2fa/email/send", {});
      setChallenge(r.challenge_token);
      setEmailMasked(r.email_masked || "");
      setDevCode(r.dev_code || null);
      setStage("code");
    } catch (e: any) {
      setError(e?.detail?.message || e?.detail || e?.message || "코드 발송 실패 (관리자에게 SMTP 설정 문의)");
    } finally {
      setSending(false);
    }
  };

  const verify = async () => {
    setVerifying(true); setError(null);
    try {
      await api.post("/api/auth/2fa/email/verify", { challenge_token: challenge, code: code.trim() });
      window.location.reload(); // 세션 발급됨 → 새로고침으로 원 요청 재시도
    } catch (e: any) {
      setError(e?.detail?.message || e?.detail || e?.message || "인증 실패");
      setVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-gray-900">2차 인증 필요</h2>
        <p className="mt-1 text-sm text-gray-600">
          성적·상담 등 민감정보 접근에는 이메일 인증이 필요합니다.
        </p>
        {error && <div className="mt-3 rounded bg-red-50 p-2 text-sm text-red-700">{error}</div>}
        {stage === "prompt" ? (
          <button
            onClick={sendCode}
            disabled={sending}
            className="mt-4 w-full rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {sending ? "발송 중..." : "이메일로 인증코드 받기"}
          </button>
        ) : (
          <div className="mt-4 space-y-2">
            <p className="text-xs text-gray-500">{emailMasked} 으로 코드를 보냈습니다.</p>
            {devCode && <p className="text-xs text-amber-600">개발용 코드: {devCode}</p>}
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              maxLength={6}
              placeholder="6자리 코드"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 tracking-widest"
            />
            <button
              onClick={verify}
              disabled={verifying || code.length < 4}
              className="w-full rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {verifying ? "확인 중..." : "확인"}
            </button>
            <button onClick={sendCode} disabled={sending} className="w-full text-xs text-gray-500 underline">
              코드 재발송
            </button>
          </div>
        )}
        <button onClick={close} className="mt-3 w-full text-sm text-gray-400 hover:text-gray-600">
          닫기
        </button>
      </div>
    </div>
  );
}
