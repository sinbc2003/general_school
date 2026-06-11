"use client";

/**
 * 보드 — 교사용 홈. 본인 보드 목록 + 나에게 공유됨 + 새 보드 만들기.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  StickyNote, Plus, X, Loader2, ChevronLeft, Globe, Users2, Share2, ExternalLink,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { backgroundOf, BOARD_BACKGROUNDS } from "@/components/board/BoardView";

interface BoardItem {
  id: number;
  title: string;
  description?: string | null;
  access_mode: string;
  columns: string[];
  background?: string;
  is_archived: boolean;
  owner_name?: string | null;
  updated_at: string | null;
}

export default function BoardHomePage() {
  const router = useRouter();
  const [boards, setBoards] = useState<BoardItem[] | null>(null);
  const [shared, setShared] = useState<BoardItem[]>([]);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    try {
      const [mine, sh] = await Promise.all([
        api.get<{ items: BoardItem[] }>("/api/classroom/boards"),
        api.get<{ items: BoardItem[] }>("/api/classroom/boards/shared-with-me").catch(() => ({ items: [] })),
      ]);
      setBoards(mine.items || []);
      setShared(sh.items || []);
    } catch {
      setBoards([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const BoardCard = ({ b, sharedBadge }: { b: BoardItem; sharedBadge?: boolean }) => {
    const bg = backgroundOf(b.background);
    return (
      <button
        onClick={() => router.push(`/tools/board/${b.id}`)}
        className="text-left border border-border-default rounded-xl bg-bg-primary hover:shadow-md hover:-translate-y-px transition overflow-hidden group"
      >
        <div className="h-16 relative" style={{ background: bg.css }}>
          <span
            onClick={(e) => {
              e.stopPropagation();
              window.open(`/tools/board/${b.id}`, "_blank", "noopener");
            }}
            className="absolute top-1.5 right-1.5 p-1.5 rounded-full bg-white/70 hover:bg-white text-gray-700 opacity-0 group-hover:opacity-100 transition cursor-pointer"
            title="새 창에서 열기"
          >
            <ExternalLink size={12} />
          </span>
        </div>
        <div className="p-3.5">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-body font-semibold truncate flex-1">{b.title}</span>
            {sharedBadge ? (
              <Share2 size={13} className="text-violet-600 flex-shrink-0" />
            ) : b.access_mode === "public" ? (
              <Globe size={13} className="text-emerald-600 flex-shrink-0" />
            ) : (
              <Users2 size={13} className="text-text-tertiary flex-shrink-0" />
            )}
          </div>
          <div className="text-caption text-text-secondary truncate">
            {sharedBadge && b.owner_name ? `${b.owner_name} 님이 공유 · ` : ""}
            {b.columns.join(" · ")}
          </div>
        </div>
      </button>
    );
  };

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
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-rose-500 hover:bg-rose-600 text-white rounded-lg text-body font-medium"
        >
          <Plus size={16} /> 새 보드
        </button>
      </div>

      {boards === null && (
        <div className="flex items-center justify-center py-16 text-text-tertiary">
          <Loader2 size={18} className="animate-spin mr-2" /> 불러오는 중...
        </div>
      )}

      {boards && boards.length === 0 && shared.length === 0 && (
        <div className="text-center py-16 border border-dashed border-border-default rounded-xl">
          <StickyNote size={40} className="mx-auto mb-3 text-text-tertiary opacity-40" />
          <div className="text-body text-text-secondary">아직 보드가 없습니다.</div>
        </div>
      )}

      {boards && boards.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {boards.map((b) => <BoardCard key={b.id} b={b} />)}
        </div>
      )}

      {shared.length > 0 && (
        <section className="mt-8">
          <h2 className="text-body font-semibold flex items-center gap-1.5 mb-3">
            <Share2 size={15} className="text-violet-600" /> 나에게 공유됨
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {shared.map((b) => <BoardCard key={`s-${b.id}`} b={b} sharedBadge />)}
          </div>
          <p className="text-[11px] text-text-tertiary mt-2">
            공유받은 보드는 열람 전용 — 열어서 "내 보드로 복사"하면 수업에 쓸 수 있습니다.
          </p>
        </section>
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
  const [background, setBackground] = useState("sunset");
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
      // 배경은 생성 직후 설정 (생성 API는 최소 유지)
      await api.put(`/api/classroom/boards/${res.id}`, { background }).catch(() => undefined);
      onCreated(res.id);
    } catch (e: any) {
      alert(e?.detail || "생성 실패");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-bg-primary rounded-lg shadow-2xl w-full max-w-md">
        <header className="flex items-center justify-between px-5 py-3 border-b border-border-default">
          <h2 className="text-body font-medium">새 보드</h2>
          <button onClick={onClose} className="p-1 hover:bg-bg-secondary rounded">
            <X size={16} />
          </button>
        </header>
        <div className="p-5 space-y-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="보드 이름*"
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") create(); }}
            className="w-full px-3 py-2 border border-border-default rounded text-body outline-none focus:border-rose-400"
          />
          <div>
            <div className="text-caption text-text-tertiary mb-1.5">배경</div>
            <div className="grid grid-cols-4 gap-2">
              {BOARD_BACKGROUNDS.map((b) => (
                <button
                  key={b.key}
                  type="button"
                  onClick={() => setBackground(b.key)}
                  className={`h-10 rounded-lg border-2 transition ${
                    background === b.key ? "border-rose-500 ring-2 ring-rose-200" : "border-border-default"
                  }`}
                  style={{ background: b.css }}
                  title={b.label}
                />
              ))}
            </div>
          </div>
          <div>
            <div className="text-caption text-text-tertiary mb-1">컬럼 (쉼표로 구분)</div>
            <input
              value={columnsText}
              onChange={(e) => setColumnsText(e.target.value)}
              className="w-full px-3 py-2 border border-border-default rounded text-body outline-none focus:border-rose-400"
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
            className="px-4 py-2 bg-rose-500 hover:bg-rose-600 disabled:opacity-40 text-white rounded-lg text-body font-medium"
          >
            {saving ? "생성 중..." : "만들기"}
          </button>
        </footer>
      </div>
    </div>
  );
}
