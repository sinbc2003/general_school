"use client";

/**
 * 보드 — 교사용 상세 (BoardView + 소유자 설정).
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Loader2, Settings, StickyNote, Trash2, X } from "lucide-react";
import { api } from "@/lib/api/client";
import { BoardView } from "@/components/board/BoardView";

interface BoardMeta {
  id: number;
  title: string;
  description?: string | null;
  access_mode: string;
  columns: string[];
  permission: { role: string | null };
}

export default function BoardDetailPage() {
  const params = useParams<{ bid: string }>();
  const router = useRouter();
  const bid = Number(params.bid);

  const [meta, setMeta] = useState<BoardMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
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

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="min-w-0">
          <Link
            href="/tools/board"
            className="inline-flex items-center gap-1 text-caption text-text-tertiary hover:text-text-primary mb-1"
          >
            <ChevronLeft size={14} /> 보드 목록
          </Link>
          <h1 className="text-title font-semibold flex items-center gap-2">
            <StickyNote size={20} className="text-amber-600" /> {meta.title}
          </h1>
          {meta.description && (
            <p className="text-caption text-text-tertiary mt-0.5">{meta.description}</p>
          )}
        </div>
        {isOwner && (
          <button
            onClick={() => setShowSettings(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border-default rounded-lg text-caption text-text-secondary hover:bg-bg-secondary"
          >
            <Settings size={14} /> 설정
          </button>
        )}
      </div>

      <BoardView key={viewKey} boardId={bid} />

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
      });
      onSaved();
    } catch (e: any) {
      alert(e?.detail || "저장 실패");
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm("보드를 삭제할까요? 모든 카드가 함께 삭제됩니다.")) return;
    try {
      await api.delete(`/api/classroom/boards/${meta.id}`);
      onDeleted();
    } catch (e: any) {
      alert(e?.detail || "삭제 실패");
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-bg-primary rounded-lg shadow-2xl w-full max-w-sm">
        <header className="flex items-center justify-between px-5 py-3 border-b border-border-default">
          <h2 className="text-body font-medium">보드 설정</h2>
          <button onClick={onClose} className="p-1 hover:bg-bg-secondary rounded">
            <X size={16} />
          </button>
        </header>
        <div className="p-5 space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 border border-border-default rounded text-body outline-none focus:border-amber-500"
          />
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
            className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white rounded-lg text-body font-medium"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </footer>
      </div>
    </div>
  );
}
