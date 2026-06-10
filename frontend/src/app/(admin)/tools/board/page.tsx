"use client";

/**
 * 보드 — 교사용 홈. 본인 보드 목록 + 새 보드 만들기.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { StickyNote, Plus, X, Loader2, ChevronLeft, Globe, Users2 } from "lucide-react";
import { api } from "@/lib/api/client";

interface BoardItem {
  id: number;
  title: string;
  description?: string | null;
  access_mode: string;
  columns: string[];
  is_archived: boolean;
  updated_at: string | null;
}

export default function BoardHomePage() {
  const router = useRouter();
  const [boards, setBoards] = useState<BoardItem[] | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ items: BoardItem[] }>("/api/classroom/boards");
      setBoards(res.items || []);
    } catch {
      setBoards([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link
            href="/tools"
            className="inline-flex items-center gap-1 text-caption text-text-tertiary hover:text-text-primary mb-1"
          >
            <ChevronLeft size={14} /> 도구 모음
          </Link>
          <h1 className="text-title font-semibold flex items-center gap-2">
            <StickyNote size={22} className="text-amber-600" /> 보드
          </h1>
          <p className="text-caption text-text-tertiary mt-1">
            담벼락에 포스트잇 카드 — 학급 전체가 실시간으로 함께 붙입니다
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-body font-medium"
        >
          <Plus size={16} /> 새 보드
        </button>
      </div>

      {boards === null && (
        <div className="flex items-center justify-center py-16 text-text-tertiary">
          <Loader2 size={18} className="animate-spin mr-2" /> 불러오는 중...
        </div>
      )}

      {boards && boards.length === 0 && (
        <div className="text-center py-16 border border-dashed border-border-default rounded-xl">
          <StickyNote size={40} className="mx-auto mb-3 text-text-tertiary opacity-40" />
          <div className="text-body text-text-secondary">아직 보드가 없습니다.</div>
        </div>
      )}

      {boards && boards.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {boards.map((b) => (
            <button
              key={b.id}
              onClick={() => router.push(`/tools/board/${b.id}`)}
              className="text-left border border-border-default rounded-xl p-4 bg-bg-primary hover:border-amber-300 hover:shadow-sm transition"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-body font-semibold truncate flex-1">{b.title}</span>
                {b.access_mode === "public"
                  ? <Globe size={13} className="text-emerald-600 flex-shrink-0" />
                  : <Users2 size={13} className="text-text-tertiary flex-shrink-0" />}
              </div>
              {b.description && (
                <div className="text-caption text-text-tertiary line-clamp-2 mb-2">{b.description}</div>
              )}
              <div className="text-caption text-text-secondary">
                컬럼: {b.columns.join(" · ")}
              </div>
            </button>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateBoardModal
          onClose={() => setShowCreate(false)}
          onCreated={(id) => router.push(`/tools/board/${id}`)}
        />
      )}
    </div>
  );
}

function CreateBoardModal({
  onClose, onCreated,
}: { onClose: () => void; onCreated: (id: number) => void }) {
  const [title, setTitle] = useState("");
  const [columnsText, setColumnsText] = useState("아이디어, 질문, 기타");
  const [accessMode, setAccessMode] = useState("members");
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      const cols = columnsText.split(",").map((c) => c.trim()).filter(Boolean);
      const res = await api.post<{ id: number }>("/api/classroom/boards", {
        title: title.trim(),
        access_mode: accessMode,
        columns: cols.length > 0 ? cols : undefined,
      });
      onCreated(res.id);
    } catch (e: any) {
      alert(e?.detail || "생성 실패");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-bg-primary rounded-lg shadow-2xl w-full max-w-sm">
        <header className="flex items-center justify-between px-5 py-3 border-b border-border-default">
          <h2 className="text-body font-medium">새 보드</h2>
          <button onClick={onClose} className="p-1 hover:bg-bg-secondary rounded">
            <X size={16} />
          </button>
        </header>
        <div className="p-5 space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="보드 이름*"
            autoFocus
            className="w-full px-3 py-2 border border-border-default rounded text-body outline-none focus:border-amber-500"
          />
          <div>
            <div className="text-caption text-text-tertiary mb-1">컬럼 (쉼표로 구분)</div>
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
        <footer className="px-5 py-3 border-t border-border-default flex justify-end">
          <button
            onClick={create}
            disabled={!title.trim() || saving}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white rounded-lg text-body font-medium"
          >
            {saving ? "생성 중..." : "만들기"}
          </button>
        </footer>
      </div>
    </div>
  );
}
