"use client";

/**
 * 화이트보드 — 교사용 상세 (캔버스 + 소유자 설정/공유, 공유받은 교사는 사본).
 * 도구 집중 모드: 진입 시 사이드바 자동 접힘.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft, Loader2, Settings, Trash2, X, Share2, ExternalLink, Copy,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { useToolFocusMode } from "@/lib/use-tool-focus";
import { WhiteboardCanvas, WB_BACKGROUNDS } from "@/components/whiteboard/WhiteboardCanvas";
import { ToolShareModal } from "@/components/tools/ToolShareModal";

interface WbMeta {
  id: number;
  title: string;
  description?: string | null;
  access_mode: string;
  background?: string;
  is_archived: boolean;
  permission: { role: string | null };
}

export default function WhiteboardDetailPage() {
  const params = useParams<{ wid: string }>();
  const router = useRouter();
  const wid = Number(params.wid);
  useToolFocusMode();

  const [meta, setMeta] = useState<WbMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [viewKey, setViewKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await api.get<WbMeta>(`/api/classroom/whiteboards/${wid}`);
      setMeta(res);
    } catch (e: any) {
      setError(e?.detail || "화이트보드를 불러올 수 없습니다");
    }
  }, [wid]);

  useEffect(() => { load(); }, [load]);

  const duplicate = async () => {
    if (duplicating) return;
    setDuplicating(true);
    try {
      const res = await api.post<{ id: number }>(`/api/classroom/whiteboards/${wid}/duplicate`);
      router.push(`/tools/whiteboard/${res.id}`);
    } catch (e: any) {
      alert(e?.detail || "사본 생성 실패");
      setDuplicating(false);
    }
  };

  if (error) {
    return (
      <div className="p-10 text-center">
        <div className="text-body text-status-error mb-3">{error}</div>
        <Link href="/tools/whiteboard" className="text-caption underline">목록으로</Link>
      </div>
    );
  }
  if (!meta) {
    return (
      <div className="flex items-center justify-center py-24 text-text-tertiary">
        <Loader2 size={20} className="animate-spin mr-2" /> 불러오는 중...
      </div>
    );
  }

  const isOwner = meta.permission.role === "owner" || meta.permission.role === "admin";
  const isSharedViewer = meta.permission.role === "viewer";
  const actionBtn =
    "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-bg-secondary hover:bg-border-default text-text-primary transition";

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-3">
        <Link
          href="/tools/whiteboard"
          className="inline-flex items-center gap-1 text-caption text-text-tertiary hover:text-text-primary"
        >
          <ChevronLeft size={14} /> 화이트보드 목록
        </Link>
      </div>

      <WhiteboardCanvas
        key={viewKey}
        whiteboardId={wid}
        headerActions={
          <>
            <button
              onClick={() => window.open(`/embed/whiteboard/${wid}`, "_blank", "noopener")}
              className={actionBtn}
              title="새 창에서 열기 — 사이드바 없이 전체 화면 (프로젝터·전자칠판)"
            >
              <ExternalLink size={12} /> 새 창
            </button>
            {isSharedViewer && (
              <button onClick={duplicate} disabled={duplicating} className={actionBtn}>
                {duplicating ? <Loader2 size={12} className="animate-spin" /> : <Copy size={12} />}
                내 것으로 복사
              </button>
            )}
            {isOwner && (
              <>
                <button onClick={() => setShowShare(true)} className={actionBtn}>
                  <Share2 size={12} /> 공유
                </button>
                <button onClick={() => setShowSettings(true)} className={actionBtn}>
                  <Settings size={12} /> 설정
                </button>
              </>
            )}
          </>
        }
      />

      {showShare && (
        <ToolShareModal
          title={meta.title}
          basePath={`/api/classroom/whiteboards/${wid}`}
          onClose={() => setShowShare(false)}
        />
      )}

      {showSettings && (
        <WbSettingsModal
          meta={meta}
          onClose={() => setShowSettings(false)}
          onSaved={async () => {
            setShowSettings(false);
            await load();
            setViewKey((k) => k + 1);
          }}
          onDeleted={() => router.push("/tools/whiteboard")}
        />
      )}
    </div>
  );
}

function WbSettingsModal({
  meta, onClose, onSaved, onDeleted,
}: {
  meta: WbMeta;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [title, setTitle] = useState(meta.title);
  const [description, setDescription] = useState(meta.description || "");
  const [background, setBackground] = useState(meta.background || "white");
  const [accessMode, setAccessMode] = useState(meta.access_mode);
  const [archived, setArchived] = useState(meta.is_archived);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      await api.put(`/api/classroom/whiteboards/${meta.id}`, {
        title: title.trim(),
        description: description.trim() || null,
        background,
        access_mode: accessMode,
        is_archived: archived,
      });
      onSaved();
    } catch (e: any) {
      alert(e?.detail || "저장 실패");
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm("화이트보드를 휴지통으로 이동할까요?\n내 드라이브 휴지통에서 30일 내 복구할 수 있습니다.")) return;
    try {
      await api.delete(`/api/classroom/whiteboards/${meta.id}`);
      onDeleted();
    } catch (e: any) {
      alert(e?.detail || "삭제 실패");
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-bg-primary rounded-lg shadow-2xl w-full max-w-sm">
        <header className="flex items-center justify-between px-5 py-3 border-b border-border-default">
          <h2 className="text-body font-medium">화이트보드 설정</h2>
          <button onClick={onClose} className="p-1 hover:bg-bg-secondary rounded">
            <X size={16} />
          </button>
        </header>
        <div className="p-5 space-y-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 border border-border-default rounded text-body outline-none focus:border-violet-500"
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="설명 (선택)"
            className="w-full px-3 py-2 border border-border-default rounded text-body outline-none focus:border-violet-500"
          />
          <div>
            <div className="text-caption text-text-tertiary mb-1.5">배경</div>
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(WB_BACKGROUNDS).map(([key, b]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setBackground(key)}
                  className={`h-12 rounded-lg border-2 relative overflow-hidden ${
                    background === key ? "border-violet-500 ring-2 ring-violet-200" : "border-border-default"
                  }`}
                  style={{
                    background: b.grid
                      ? "repeating-linear-gradient(0deg,#fff,#fff 7px,#e2e8f0 8px),repeating-linear-gradient(90deg,#fff,#fff 7px,#e2e8f0 8px)"
                      : b.fill,
                  }}
                >
                  <span className={`absolute bottom-0.5 left-1.5 text-[9px] font-semibold ${b.dark ? "text-white/90" : "text-gray-700"}`}>
                    {b.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <select
            value={accessMode}
            onChange={(e) => setAccessMode(e.target.value)}
            className="w-full px-3 py-2 border border-border-default rounded text-body bg-bg-primary"
          >
            <option value="members">멤버만 — 강좌 글에 첨부한 수강생</option>
            <option value="public">전체 공개 — 인증 사용자 누구나 참여</option>
          </select>
          <label className="flex items-center gap-2 text-body cursor-pointer">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
            보관 (읽기 전용 — 더 이상 그릴 수 없음)
          </label>
        </div>
        <footer className="px-5 py-3 border-t border-border-default flex items-center justify-between">
          <button
            onClick={remove}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-caption text-red-600 hover:bg-red-50 rounded"
          >
            <Trash2 size={13} /> 삭제
          </button>
          <button
            onClick={save}
            disabled={!title.trim() || saving}
            className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white rounded-lg text-body font-medium"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </footer>
      </div>
    </div>
  );
}
