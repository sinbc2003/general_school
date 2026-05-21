"use client";

/**
 * Google Drive 사이드 패널 — Drive 페이지 우측에 표시.
 *
 * 상태:
 *  1. 설정 안 됨 → "관리자 설정 필요" 안내
 *  2. 연결 안 됨 → "Google 계정 연결" 버튼
 *  3. 연결됨 → 파일 그리드 (검색 + page)
 */

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, RefreshCw, X, Search, LogOut, FileText, FileSpreadsheet, Presentation, File } from "lucide-react";
import { api } from "@/lib/api/client";

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  iconLink?: string;
  webViewLink?: string;
  modifiedTime?: string;
  size?: string;
  thumbnailLink?: string;
}

interface DriveStatus {
  connected: boolean;
  google_email: string | null;
  connected_at: string | null;
}

function fileTypeIcon(mime: string) {
  if (mime === "application/vnd.google-apps.document") return <FileText size={28} className="text-blue-600" />;
  if (mime === "application/vnd.google-apps.spreadsheet") return <FileSpreadsheet size={28} className="text-emerald-600" />;
  if (mime === "application/vnd.google-apps.presentation") return <Presentation size={28} className="text-amber-600" />;
  if (mime === "application/vnd.google-apps.folder") return <File size={28} className="text-yellow-600" />;
  return <File size={28} className="text-text-tertiary" />;
}

export function GoogleDriveSidePanel({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const s = await api.get<DriveStatus>("/api/google/me");
      setStatus(s);
      return s;
    } catch (e: any) {
      setError(e?.message || "상태 조회 실패");
      return null;
    }
  }, []);

  const loadFiles = useCallback(async (q?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page_size: "30" });
      if (q?.trim()) params.set("q", `name contains '${q.trim().replace(/'/g, "")}'`);
      const r = await api.get<{ files: DriveFile[] }>(`/api/google/drive/files?${params}`);
      setFiles(r.files || []);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Drive 호출 실패");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    (async () => {
      const s = await loadStatus();
      if (s?.connected) await loadFiles();
      else setLoading(false);
    })();
  }, [loadStatus, loadFiles]);

  const connect = async () => {
    setError(null);
    try {
      const r = await api.get<{ url: string }>("/api/google/auth-url");
      const popup = window.open(r.url, "google_oauth", "width=520,height=640");
      const handler = (e: MessageEvent) => {
        if (e.data?.type === "google_connected") {
          window.removeEventListener("message", handler);
          popup?.close();
          loadStatus().then((s) => { if (s?.connected) loadFiles(); });
        }
      };
      window.addEventListener("message", handler);
    } catch (e: any) {
      const msg = e?.detail || e?.message || "";
      // 503: super_admin이 OAuth Client ID/Secret 미등록
      if (e?.status === 503 || msg.includes("설정되지 않") || msg.includes("OAuth")) {
        setError(
          "Google 연동이 설정되지 않았습니다.\n" +
          "최고관리자가 /system/integrations/google 에서 Google Cloud Console의 Client ID/Secret 을 등록해야 합니다.",
        );
      } else {
        setError(msg || "OAuth 시작 실패");
      }
    }
  };

  const disconnect = async () => {
    if (!confirm("Google 계정 연결을 해제합니다.\n저장된 토큰이 삭제되며, 다시 사용하려면 재연결이 필요합니다.\n진행하시겠습니까?")) return;
    try {
      await api.delete("/api/google/me");
      await loadStatus();
      setFiles([]);
    } catch (e: any) {
      alert(e?.message || "연결 해제 실패");
    }
  };

  return (
    <div className="bg-bg-primary border-l border-border-default flex flex-col h-full">
      {/* 헤더 */}
      <div className="px-4 py-3 border-b border-border-default flex items-center justify-between bg-bg-secondary/30">
        <div className="flex items-center gap-2">
          <Globe size={16} className="text-text-secondary" />
          <span className="text-[13px] font-semibold text-text-primary">Google Drive</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded hover:bg-bg-secondary text-text-tertiary"
          title="패널 닫기"
        >
          <X size={14} />
        </button>
      </div>

      {/* 본문 */}
      {!status ? (
        <div className="flex-1 flex items-center justify-center text-text-tertiary text-[13px]">
          로딩 중...
        </div>
      ) : !status.connected ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <Globe size={40} className="text-text-tertiary mb-3" />
          <div className="text-body font-medium text-text-primary mb-1">
            Google 계정 연결
          </div>
          <p className="text-[12px] text-text-tertiary mb-4 max-w-xs">
            본인 Google Drive 파일을 학교 플랫폼에서 직접 조회·import·export 할 수 있습니다.
          </p>
          <button
            type="button"
            onClick={connect}
            className="px-4 py-2 text-[13px] bg-accent text-white rounded hover:opacity-90 flex items-center gap-1.5"
          >
            <Globe size={14} /> Google 계정 연결
          </button>
          {error && (
            <div className="mt-4 text-[11.5px] text-amber-900 bg-amber-50 border border-amber-200 rounded p-3 max-w-xs whitespace-pre-line text-left leading-relaxed">
              {error}
              {error.includes("/system/integrations/google") && (
                <a
                  href="/system/integrations/google"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block mt-2 text-accent underline"
                >
                  설정 페이지 열기 →
                </a>
              )}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* 사용자 정보 + 검색 */}
          <div className="px-4 py-2 border-b border-border-default">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] text-text-tertiary truncate">
                {status.google_email}
              </div>
              <button
                type="button"
                onClick={disconnect}
                className="text-[11px] text-text-tertiary hover:text-red-500 flex items-center gap-1"
                title="연결 해제"
              >
                <LogOut size={11} /> 해제
              </button>
            </div>
            <div className="relative">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadFiles(search)}
                placeholder="Drive에서 검색..."
                className="w-full pl-7 pr-7 py-1.5 text-[12px] border border-border-default rounded bg-bg-primary"
              />
              <button
                type="button"
                onClick={() => loadFiles(search)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-accent"
                title="검색"
              >
                <RefreshCw size={12} />
              </button>
            </div>
          </div>

          {/* 파일 그리드 */}
          <div className="flex-1 overflow-y-auto p-3">
            {loading ? (
              <div className="text-center text-[12px] text-text-tertiary py-8">불러오는 중...</div>
            ) : error ? (
              <div className="text-center text-[12px] text-red-600 py-8">{error}</div>
            ) : files.length === 0 ? (
              <div className="text-center text-[12px] text-text-tertiary py-8">파일 없음</div>
            ) : (
              <div className="space-y-1">
                {files.map((f) => (
                  <a
                    key={f.id}
                    href={f.webViewLink || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-2 py-2 rounded hover:bg-bg-secondary text-left group"
                  >
                    <div className="flex-shrink-0">
                      {fileTypeIcon(f.mimeType)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] text-text-primary truncate">{f.name}</div>
                      <div className="text-[10px] text-text-tertiary">
                        {f.modifiedTime?.slice(0, 16).replace("T", " ")}
                      </div>
                    </div>
                    <ExternalLink size={11} className="text-text-tertiary opacity-0 group-hover:opacity-100" />
                  </a>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Globe 아이콘 (Lucide 안 import한 경우 fallback)
import { Globe } from "lucide-react";
