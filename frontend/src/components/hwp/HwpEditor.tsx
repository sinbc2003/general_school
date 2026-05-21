"use client";

/**
 * HWP/HWPX 에디터 — rhwp(@rhwp/editor) iframe 임베드.
 *
 * - 협업 미지원 (rhwp v2 로드맵). 단독 편집 + 저장 시 backend 업로드.
 * - 동시 편집 시 마지막 저장 우선 (LWW).
 * - iframe이 `https://edwardkim.github.io/rhwp/` 외부 사이트를 로드.
 *   학교 네트워크에서 github.io 차단되면 안 됨. 보통 5~15초 소요.
 * - mount 시 backend 파일 URL fetch → editor.loadFile(buffer)
 * - "저장" 클릭 → editor.exportHwpx() → PUT /api/classroom/hwps/{id}/file
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Save, Loader2, Download, Upload, RefreshCw, ExternalLink } from "lucide-react";

interface Props {
  hwpId: number;
  canWrite: boolean;
  /** mount 시 로드할 파일 — server file_path (storage 안 상대 경로) */
  initialFilePath: string | null;
  initialFileFormat: "hwp" | "hwpx" | null;
  /** 저장/로드 성공 후 부모에 알림 (메타 reload용) */
  onSaved?: () => void;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8002";
const STUDIO_URL = "https://edwardkim.github.io/rhwp/";


export function HwpEditor({
  hwpId, canWrite, initialFilePath, initialFileFormat, onSaved,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<any>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [phase, setPhase] = useState<string>("패키지 로드 중...");
  const [elapsed, setElapsed] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  // ── 경과 시간 카운터 (loading 중에만)
  useEffect(() => {
    if (status !== "loading") return;
    const start = Date.now();
    const t = setInterval(() => setElapsed(Math.round((Date.now() - start) / 1000)), 500);
    return () => clearInterval(t);
  }, [status, retryNonce]);

  // ── editor mount ───────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    setStatus("loading");
    setPhase("패키지 로드 중...");
    setError(null);
    setElapsed(0);
    let cancelled = false;
    let editor: any = null;
    (async () => {
      try {
        setPhase("@rhwp/editor 패키지 로드 중...");
        const mod: any = await import("@rhwp/editor");
        if (cancelled) return;
        setPhase(`외부 스튜디오 로드 중 (${STUDIO_URL})...`);
        editor = await mod.createEditor(containerRef.current);
        editorRef.current = editor;

        // 기존 파일 로드 (있으면)
        if (initialFilePath) {
          try {
            setPhase("기존 파일 로드 중...");
            const token = typeof window !== "undefined"
              ? localStorage.getItem("access_token")
              : null;
            const res = await fetch(`${API_URL}/api/files/storage/${initialFilePath}`, {
              headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const buf = await res.arrayBuffer();
            const name = `document.${initialFileFormat || "hwpx"}`;
            await editor.loadFile(buf, name);
          } catch (e: any) {
            console.warn("[HwpEditor] initial load failed:", e);
            // 로드 실패해도 editor는 정상 동작 — 사용자에게 안내만
            setError(`기존 파일 로드 실패: ${e?.message || e}. 빈 상태에서 새로 작성하세요.`);
          }
        }
        if (cancelled) {
          try { editor?.destroy?.(); } catch {}
          return;
        }
        setStatus("ready");
      } catch (e: any) {
        console.error("[HwpEditor] mount failed:", e);
        if (!cancelled) {
          setStatus("error");
          setError(e?.message || "에디터 초기화 실패");
        }
      }
    })();
    return () => {
      cancelled = true;
      try { editor?.destroy?.(); } catch {}
      editorRef.current = null;
      if (containerRef.current) containerRef.current.innerHTML = "";
    };
    // initialFilePath 변경 시에만 재마운트 (hwpId 같이 바뀌면 자동)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hwpId, retryNonce]);

  // ── 저장 ───────────────────────────────────────────────────
  const save = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    setSaving(true);
    try {
      const bytes: Uint8Array = await editor.exportHwpx();
      const blob = new Blob([bytes as BlobPart], { type: "application/vnd.hancom.hwpx" });
      const form = new FormData();
      form.append("file", blob, `document.hwpx`);
      const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
      const res = await fetch(`${API_URL}/api/classroom/hwps/${hwpId}/file`, {
        method: "PUT",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onSaved?.();
    } catch (e: any) {
      alert(`저장 실패: ${e?.message || e}`);
    } finally {
      setSaving(false);
    }
  }, [hwpId, onSaved]);

  // ── 다운로드 — 사용자 PC로 .hwpx 받기 ──────────────────────
  const download = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    try {
      const bytes: Uint8Array = await editor.exportHwpx();
      const blob = new Blob([bytes as BlobPart], { type: "application/vnd.hancom.hwpx" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `document.hwpx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(`다운로드 실패: ${e?.message || e}`);
    }
  }, []);

  // ── 외부 파일 import — 사용자 PC의 .hwp/.hwpx 로드 ───────
  const importFile = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".hwp,.hwpx";
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const buf = await file.arrayBuffer();
      try {
        await editor.loadFile(buf, file.name);
      } catch (err: any) {
        alert(`파일 로드 실패: ${err?.message || err}`);
      }
    };
    input.click();
  }, []);

  const slowWarn = status === "loading" && elapsed >= 8;

  return (
    <div className="flex flex-col h-full border border-border-default rounded-lg overflow-hidden bg-white">
      <div className="flex-shrink-0 px-3 py-1.5 bg-bg-secondary border-b border-border-default flex items-center gap-2 text-caption">
        {status === "loading" && (
          <span className="text-text-tertiary inline-flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin" />
            {phase} ({elapsed}s)
          </span>
        )}
        {status === "ready" && (
          <span className="text-emerald-700">● 준비됨</span>
        )}
        {status === "error" && (
          <span className="text-status-error">⚠ 에디터 로드 실패</span>
        )}
        {error && (
          <span className="text-status-error text-[11px] truncate" title={error}>{error}</span>
        )}
        <div className="flex-1" />
        {status === "error" && (
          <button
            onClick={() => setRetryNonce((n) => n + 1)}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11.5px] bg-white border border-border-default rounded hover:bg-bg-primary"
          >
            <RefreshCw size={11} /> 재시도
          </button>
        )}
        {canWrite && status === "ready" && (
          <>
            <button
              onClick={importFile}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11.5px] bg-white border border-border-default rounded hover:bg-bg-primary"
              title="내 PC의 .hwp/.hwpx 파일 로드"
            >
              <Upload size={11} /> 가져오기
            </button>
            <button
              onClick={download}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11.5px] bg-white border border-border-default rounded hover:bg-bg-primary"
              title="내 PC로 .hwpx 다운로드"
            >
              <Download size={11} /> 다운로드
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1 px-3 py-1 text-[11.5px] bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
              title="서버에 저장 (HWPX)"
            >
              {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
              {saving ? "저장 중..." : "저장"}
            </button>
          </>
        )}
      </div>

      {/* 로딩/에러 오버레이 안내 (편집 영역에 겹쳐 보이도록) */}
      {status !== "ready" && (
        <div className="flex-shrink-0 px-4 py-3 bg-amber-50 border-b border-amber-200 text-[12px] text-amber-900">
          {status === "loading" && (
            <>
              <div className="font-medium mb-1">
                {slowWarn ? "⏳ 외부 사이트 로딩이 느립니다" : "🔄 HWP 에디터 초기화 중"}
              </div>
              <div className="text-[11.5px] text-amber-800">
                {slowWarn ? (
                  <>
                    <code className="bg-white px-1 rounded">{STUDIO_URL}</code> 에서 WASM 다운로드 중. 학교 네트워크가 github.io를 차단했다면 실패합니다. (10~15초 더 대기)
                  </>
                ) : (
                  <>외부 스튜디오(github.io) + WASM 로드. 보통 5~15초 소요.</>
                )}
              </div>
            </>
          )}
          {status === "error" && (
            <>
              <div className="font-medium mb-1">에디터를 초기화할 수 없습니다</div>
              <div className="text-[11.5px] text-amber-800 mb-2">
                다음 원인 중 하나일 수 있습니다:
                <ul className="list-disc pl-5 mt-1 space-y-0.5">
                  <li>네트워크에서 <code className="bg-white px-1 rounded">{STUDIO_URL}</code> 접근 차단 (학교 방화벽 등)</li>
                  <li>브라우저의 third-party 스크립트/iframe 차단</li>
                  <li>일시적 인터넷 끊김</li>
                </ul>
              </div>
              <a
                href={STUDIO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-amber-900 underline"
              >
                <ExternalLink size={11} /> 외부 스튜디오 직접 접속 시도
              </a>
            </>
          )}
        </div>
      )}

      <div
        ref={containerRef}
        className="flex-1 min-h-0 bg-white"
        style={{ minHeight: 400 }}
      />
    </div>
  );
}
