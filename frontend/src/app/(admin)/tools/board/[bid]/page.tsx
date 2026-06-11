"use client";

/**
 * 보드 — 교사용 상세 (BoardView + 소유자 설정/공유, 공유받은 교사는 사본 생성).
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
import { BoardView, BOARD_BACKGROUNDS } from "@/components/board/BoardView";
import { ToolShareModal } from "@/components/tools/ToolShareModal";

interface BoardMeta {
  id: number;
  title: string;
  description?: string | null;
  access_mode: string;
  columns: string[];
  background?: string;
  permission: { role: string | null };
}

export default function BoardDetailPage() {
  const params = useParams<{ bid: string }>();
  const router = useRouter();
  const bid = Number(params.bid);
  useToolFocusMode();

  const [meta, setMeta] = useState<BoardMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [viewKey, setViewKey] = useState(0); // 설정 변경 후 BoardView 재마운트

  const load = useCallback(async () => {
    try {
      const res = await api.get<BoardMeta>(`/api/classroom/boards/${bid}`);
      setMeta(res);
    } catch (e: any) {
      setError(e?.detail || "보드를 불러올 수 없습니다");
    }
  }, [bid]);

  useEffect(() => { load(); }, [load]);

  const duplicate = async () => {
    if (duplicating) return;
    setDuplicating(true);
    try {
      const res = await api.post<{ id: number }>(`/api/classroom/boards/${bid}/duplicate`);
      router.push(`/tools/board/${res.id}`);
    } catch (e: any) {
      alert(e?.detail || "사본 생성 실패");
      setDuplicating(false);
    }
  };

  if (error) {
    return (
      <div className="p-10 text-center">
        <div className="text-body text-status-error mb-3">{error}</div>
        <Link href="/tools/board" className="text-caption underline">목록으로</Link>
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
    "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-white/70 hover:bg-white text-gray-800 shadow-sm transition";

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-3">
        <Link
          href="/tools/board"
          className="inline-flex items-center gap-1 text-caption text-text-tertiary hover:text-text-primary"
        >
          <ChevronLeft size={14} /> 보드 목록
        </Link>
      </div>

      <BoardView
        key={viewKey}
        boardId={bid}
        headerActions={
          <>
            <button
              onClick={() => window.open(`/tools/board/${bid}`, "_blank", "noopener")}
              className={actionBtn}
              title="새 창에서 열기 (프로젝터·듀얼 모니터)"
            >
              <ExternalLink size={12} /> 새 창
            </button>
            {isSharedViewer && (
              <button onClick={duplicate} disabled={duplicating} className={actionBtn}>
                {duplicating ? <Loader2 size={12} className="animate-spin" /> : <Copy size={12} />}
                내 보드로 복사
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
          basePath={`/api/classroom/boards/${bid}`}
          onClose={() => setShowShare(false)}
        />
      )}

      {showSettings && (
        <BoardSettingsModal
          meta={meta}
          onClose={() => setShowSettings(false)}
          onSaved={async () => {
            setShowSettings(false);
            await load();
            setViewKey((k) => k + 1);
          }}
          onDeleted={() => router.push("/tools/board")}
        />
      )}
    </div>
  );
}

function BoardSettingsModal({
  meta, onClose, onSaved, onDeleted,
}: {
  meta: BoardMeta;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [title, setTitle] = useState(meta.title);
  const [columnsText, setColumnsText] = useState(meta.columns.join(", "));
  const [accessMode, setAccessMode] = useState(meta.access_mode);
  const [background, setBackground] = useState(meta.background || "cream");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      const cols = columnsText.split(",").map((c) => c.trim()).filter(Boolean);
      await api.put(`/api/classroom/boards/${meta.id}`, {
        title: title.trim(),
        access_mode: accessMode,
        columns: cols,
        background,
      });
      onSaved();
    } catch (e: any) {
      alert(e?.detail || "저장 실패");
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm("보드를 휴지통으로 이동할까요?\n내 드라이브 휴지통에서 30일 내 복구할 수 있습니다.")) return;
    try {
      await api.delete(`/api/classroom/boards/${meta.id}`);
      onDeleted();
    } catch (e: any) {
      alert(e?.detail || "삭제 실패");
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-bg-primary rounded-lg shadow-2xl w-full max-w-md">
        <header className="flex items-center justify-between px-5 py-3 border-b border-border-default">
          <h2 className="text-body font-medium">보드 설정</h2>
          <button onClick={onClose} className="p-1 hover:bg-bg-secondary rounded">
            <X size={16} />
          </button>
        </header>
        <div className="p-5 space-y-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 border border-border-default rounded text-body outline-none focus:border-amber-500"
          />

          {/* 배경 테마 */}
          <div>
            <div className="text-caption text-text-tertiary mb-1.5">배경</div>
            <div className="grid grid-cols-4 gap-2">
              {BOARD_BACKGROUNDS.map((b) => (
                <button
                  key={b.key}
                  type="button"
                  onClick={() => setBackground(b.key)}
                  className={`h-12 rounded-lg border-2 transition relative overflow-hidden ${
                    background === b.key ? "border-rose-500 ring-2 ring-rose-200" : "border-border-default"
                  }`}
                  style={{ background: b.css }}
                  title={b.label}
                >
                  <span className={`absolute bottom-0.5 left-1.5 text-[9px] font-semibold ${b.dark ? "text-white/90" : "text-gray-700"}`}>
                    {b.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-caption text-text-tertiary mb-1">
              컬럼 (쉼표 구분 — 컬럼을 줄이면 기존 카드는 첫 컬럼으로)
            </div>
            <input
              value={columnsText}
              onChange={(e) => setColumnsText(e.target.value)}
              className="w-full px-3 py-2 border border-border-default rounded text-body outline-none focus:border-amber-500"
            />
          </div>
          <select
            value={accessMode}
            onChange={(e) => setAccessMode(e.target.value)}
            className="w-full px-3 py-2 border border-border-default rounded text-body bg-bg-primary"
          >
            <option value="members">멤버만 — 강좌 글에 첨부한 수강생</option>
            <option value="public">전체 공개 — 인증 사용자 누구나 참여</option>
          </select>
        </div>
        <footer className="px-5 py-3 border-t border-border-default flex items-center justify-between">
          <button
            onClick={remove}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-caption text-red-600 hover:bg-red-50 rounded"
          >
            <Trash2 size={13} /> 보드 삭제
          </button>
          <button
            onClick={save}
            disabled={!title.trim() || saving}
            className="px-4 py-2 bg-rose-500 hover:bg-rose-600 disabled:opacity-40 text-white rounded-lg text-body font-medium"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </footer>
      </div>
    </div>
  );
}
