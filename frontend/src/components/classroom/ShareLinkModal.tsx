"use client";

/**
 * 단축 링크 + QR 공유 모달.
 *
 * 마운트 시: POST /api/classroom/links (멱등 — 같은 target이면 재사용)
 * QR 미리보기: fetch + blob (Authorization 필요)
 *
 * 사용 예:
 *   <ShareLinkModal targetType="survey" targetId={42} targetTitle="피드백 설문" onClose={...} />
 */

import { useCallback, useEffect, useState } from "react";
import { X, Copy, Check, Download, QrCode, Link as LinkIcon, Loader2 } from "lucide-react";
import { api } from "@/lib/api/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8002";

interface ShareLinkModalProps {
  targetType: "survey" | "document";
  targetId: number;
  targetTitle?: string;
  onClose: () => void;
}

interface ShortLink {
  id: number;
  slug: string;
  short_url: string;
  target_type: string;
  target_id: number;
  click_count: number;
  expires_at: string | null;
}

export default function ShareLinkModal({
  targetType, targetId, targetTitle, onClose,
}: ShareLinkModalProps) {
  const [link, setLink] = useState<ShortLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);

  // 1) 링크 생성/재사용
  const ensureLink = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post<ShortLink>("/api/classroom/links", {
        target_type: targetType,
        target_id: targetId,
      });
      setLink(res);
    } catch (e: any) {
      setError(e?.detail || "단축 링크 생성 실패");
    } finally {
      setLoading(false);
    }
  }, [targetType, targetId]);

  useEffect(() => {
    ensureLink();
  }, [ensureLink]);

  // 2) QR 이미지 fetch (Authorization 헤더 필요 → blob URL)
  useEffect(() => {
    if (!link) return;
    let revokeUrl: string | null = null;
    (async () => {
      try {
        const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
        const res = await fetch(`${API_URL}/api/classroom/links/${link.slug}/qr.png`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        revokeUrl = URL.createObjectURL(blob);
        setQrUrl(revokeUrl);
      } catch (e: any) {
        setError(`QR 코드 로딩 실패: ${e?.message || e}`);
      }
    })();
    return () => {
      if (revokeUrl) URL.revokeObjectURL(revokeUrl);
    };
  }, [link]);

  const copyUrl = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.short_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 일부 환경(HTTP 비-secure)은 clipboard 막힘 → fallback: select + execCommand
      const ta = document.createElement("textarea");
      ta.value = link.short_url;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
      document.body.removeChild(ta);
    }
  };

  const downloadQr = () => {
    if (!qrUrl || !link) return;
    const a = document.createElement("a");
    a.href = qrUrl;
    a.download = `qr_${link.slug}.png`;
    a.click();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-bg-primary rounded-lg shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b border-border-default">
          <h2 className="text-body font-semibold inline-flex items-center gap-1">
            <LinkIcon size={14} /> 공유 링크
          </h2>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {targetTitle && (
            <div className="text-caption text-text-tertiary truncate">
              {targetTitle}
            </div>
          )}

          {loading && (
            <div className="text-center py-8">
              <Loader2 size={20} className="text-accent mx-auto animate-spin mb-2" />
              <div className="text-caption text-text-tertiary">링크 생성 중...</div>
            </div>
          )}

          {error && (
            <div className="text-caption text-status-error border border-status-error rounded p-3">
              {error}
            </div>
          )}

          {link && !loading && (
            <>
              {/* URL + 복사 */}
              <div>
                <label className="text-caption text-text-secondary block mb-1">단축 URL</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={link.short_url}
                    readOnly
                    onClick={(e) => e.currentTarget.select()}
                    className="flex-1 px-2 py-1.5 text-caption font-mono border border-border-default rounded bg-bg-secondary"
                  />
                  <button
                    onClick={copyUrl}
                    className={`flex items-center gap-1 px-3 py-1.5 text-caption rounded whitespace-nowrap ${
                      copied
                        ? "bg-status-success text-white"
                        : "bg-accent text-white hover:bg-accent-hover"
                    }`}
                  >
                    {copied ? (
                      <>
                        <Check size={12} /> 복사됨
                      </>
                    ) : (
                      <>
                        <Copy size={12} /> 복사
                      </>
                    )}
                  </button>
                </div>
                <div className="text-[11px] text-text-tertiary mt-1">
                  클릭 {link.click_count}회
                </div>
              </div>

              {/* QR 미리보기 */}
              <div>
                <label className="text-caption text-text-secondary block mb-1 inline-flex items-center gap-1">
                  <QrCode size={11} /> QR 코드
                </label>
                <div className="flex items-center justify-center bg-white border border-border-default rounded p-3">
                  {qrUrl ? (
                    <img src={qrUrl} alt="QR 코드" className="w-48 h-48 object-contain" />
                  ) : (
                    <Loader2 size={20} className="text-accent animate-spin" />
                  )}
                </div>
              </div>

              <button
                onClick={downloadQr}
                disabled={!qrUrl}
                className="w-full flex items-center justify-center gap-1 px-3 py-2 text-caption border border-border-default rounded hover:bg-bg-secondary disabled:opacity-50"
              >
                <Download size={12} /> PNG 다운로드
              </button>

              <div className="text-[11px] text-text-tertiary text-center">
                QR을 빔프로젝터에 띄우거나 학생에게 카톡으로 보내세요.
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end p-3 border-t border-border-default">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-caption border border-border-default rounded"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
