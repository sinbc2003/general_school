"use client";

/**
 * 화이트보드 — 교사용 홈. 본인 목록 + 나에게 공유됨 + 새로 만들기.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  PenTool, Plus, X, Loader2, ChevronLeft, Globe, Users2, Share2, ExternalLink,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { WB_BACKGROUNDS } from "@/components/whiteboard/WhiteboardCanvas";

interface WbItem {
  id: number;
  title: string;
  description?: string | null;
  access_mode: string;
  background?: string;
  is_archived: boolean;
  owner_name?: string | null;
  updated_at: string | null;
}

export default function WhiteboardHomePage() {
  const router = useRouter();
  const [items, setItems] = useState<WbItem[] | null>(null);
  const [shared, setShared] = useState<WbItem[]>([]);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    try {
      const [mine, sh] = await Promise.all([
        api.get<{ items: WbItem[] }>("/api/classroom/whiteboards"),
        api.get<{ items: WbItem[] }>("/api/classroom/whiteboards/shared-with-me").catch(() => ({ items: [] })),
      ]);
      setItems(mine.items || []);
      setShared(sh.items || []);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const WbCard = ({ w, sharedBadge }: { w: WbItem; sharedBadge?: boolean }) => {
    const bg = WB_BACKGROUNDS[w.background || "white"] || WB_BACKGROUNDS.white;
    return (
      <button
        onClick={() => router.push(`/tools/whiteboard/${w.id}`)}
        className="text-left border border-border-default rounded-xl bg-bg-primary hover:shadow-md hover:-translate-y-px transition overflow-hidden group"
      >
        <div
          className="h-16 relative border-b border-border-default"
          style={{
            background: bg.grid
              ? "repeating-linear-gradient(0deg,#fff,#fff 11px,#e2e8f0 12px),repeating-linear-gradient(90deg,#fff,#fff 11px,#e2e8f0 12px)"
              : bg.fill,
          }}
        >
          <span
            onClick={(e) => {
              e.stopPropagation();
              window.open(`/tools/whiteboard/${w.id}`, "_blank", "noopener");
            }}
            className="absolute top-1.5 right-1.5 p-1.5 rounded-full bg-white/80 hover:bg-white text-gray-700 opacity-0 group-hover:opacity-100 transition cursor-pointer shadow-sm"
            title="새 창에서 열기"
          >
            <ExternalLink size={12} />
          </span>
        </div>
        <div className="p-3.5">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-body font-semibold truncate flex-1">{w.title}</span>
            {sharedBadge ? (
              <Share2 size={13} className="text-violet-600 flex-shrink-0" />
            ) : w.access_mode === "public" ? (
              <Globe size={13} className="text-emerald-600 flex-shrink-0" />
            ) : (
              <Users2 size={13} className="text-text-tertiary flex-shrink-0" />
            )}
          </div>
          <div className="text-caption text-text-secondary truncate">
            {sharedBadge && w.owner_name ? `${w.owner_name} 님이 공유 · ` : ""}
            {bg.label} 배경{w.is_archived ? " · 보관됨" : ""}
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
            <PenTool size={22} className="text-violet-600" /> 화이트보드
          </h1>
          <p className="text-caption text-text-tertiary mt-1">
            펜·도형·텍스트로 학급 전체가 실시간으로 함께 그립니다
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-body font-medium"
        >
          <Plus size={16} /> 새 화이트보드
        </button>
      </div>

      {items === null && (
        <div className="flex items-center justify-center py-16 text-text-tertiary">
          <Loader2 size={18} className="animate-spin mr-2" /> 불러오는 중...
        </div>
      )}

      {items && items.length === 0 && shared.length === 0 && (
        <div className="text-center py-16 border border-dashed border-border-default rounded-xl">
          <PenTool size={40} className="mx-auto mb-3 text-text-tertiary opacity-40" />
          <div className="text-body text-text-secondary">아직 화이트보드가 없습니다.</div>
        </div>
      )}

      {items && items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map((w) => <WbCard key={w.id} w={w} />)}
        </div>
      )}

      {shared.length > 0 && (
        <section className="mt-8">
          <h2 className="text-body font-semibold flex items-center gap-1.5 mb-3">
            <Share2 size={15} className="text-violet-600" /> 나에게 공유됨
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {shared.map((w) => <WbCard key={`s-${w.id}`} w={w} sharedBadge />)}
          </div>
          <p className="text-[11px] text-text-tertiary mt-2">
            공유받은 화이트보드는 열람 전용 — 열어서 "내 것으로 복사"하면 수업에 쓸 수 있습니다.
          </p>
        </section>
      )}

      {showCreate && (
        <CreateWbModal
          onClose={() => setShowCreate(false)}
          onCreated={(id) => router.push(`/tools/whiteboard/${id}`)}
        />
      )}
    </div>
  );
}

function CreateWbModal({
  onClose, onCreated,
}: { onClose: () => void; onCreated: (id: number) => void }) {
  const [title, setTitle] = useState("");
  const [background, setBackground] = useState("white");
  const [accessMode, setAccessMode] = useState("members");
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      const res = await api.post<{ id: number }>("/api/classroom/whiteboards", {
        title: title.trim(), background, access_mode: accessMode,
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
          <h2 className="text-body font-medium">새 화이트보드</h2>
          <button onClick={onClose} className="p-1 hover:bg-bg-secondary rounded">
            <X size={16} />
          </button>
        </header>
        <div className="p-5 space-y-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="화이트보드 이름*"
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") create(); }}
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
        </div>
        <footer className="px-5 py-3 border-t border-border-default flex justify-end">
          <button
            onClick={create}
            disabled={!title.trim() || saving}
            className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white rounded-lg text-body font-medium"
          >
            {saving ? "생성 중..." : "만들기"}
          </button>
        </footer>
      </div>
    </div>
  );
}
