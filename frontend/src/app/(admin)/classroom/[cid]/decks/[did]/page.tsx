"use client";

/**
 * 프리젠테이션 편집기 placeholder — Phase P2~P4에서 본격 구현.
 *
 * 현재는 메타 표시 + 슬라이드 추가/삭제 + 순서 변경 + 빈 본문 자리만.
 * Yjs 통합 + 본문 편집은 P2·P3에서.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, Plus, Trash2, Presentation, ChevronUp, ChevronDown, Share2,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { useToast } from "@/components/ui/Toast";

interface Permission {
  can_read: boolean;
  can_write: boolean;
  can_share: boolean;
  role: string | null;
}

interface Slide {
  id: number;
  presentation_id: number;
  order: number;
  title: string | null;
  plain_text: string | null;
}

interface DeckDetail {
  id: number;
  course_id: number | null;
  owner_id: number;
  owner_name?: string;
  title: string;
  access_mode: string;
  is_archived: boolean;
  slide_count: number;
  slides: Slide[];
  permission: Permission;
}

export default function CourseDeckEditorAdminPage() {
  const params = useParams();
  const router = useRouter();
  const toast = useToast();
  const cid = Number(params.cid);
  const did = Number(params.did);

  const [deck, setDeck] = useState<DeckDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSlide, setActiveSlide] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get<DeckDetail>(`/api/classroom/decks/${did}`);
      setDeck(d);
      if (d.slides[0] && activeSlide === null) {
        setActiveSlide(d.slides[0].id);
      }
    } catch (e: any) {
      toast.show(e?.detail || "deck 조회 실패", "error");
      router.push(`/classroom/${cid}/decks`);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [did, cid, router]);

  useEffect(() => { load(); }, [load]);

  const addSlide = async () => {
    if (!deck) return;
    try {
      const s = await api.post<Slide>(`/api/classroom/decks/${did}/slides`, {
        title: `슬라이드 ${deck.slides.length + 1}`,
      });
      await load();
      setActiveSlide(s.id);
      toast.show("슬라이드 추가됨", "success");
    } catch (e: any) {
      toast.show(e?.detail || "추가 실패", "error");
    }
  };

  const deleteSlide = async (sid: number) => {
    if (!confirm("이 슬라이드를 삭제합니까?")) return;
    try {
      await api.delete(`/api/classroom/decks/slides/${sid}`);
      await load();
      toast.show("슬라이드 삭제됨", "success");
    } catch (e: any) {
      toast.show(e?.detail || "삭제 실패", "error");
    }
  };

  const moveSlide = async (idx: number, dir: -1 | 1) => {
    if (!deck) return;
    const newOrder = deck.slides.map((s) => s.id);
    const target = idx + dir;
    if (target < 0 || target >= newOrder.length) return;
    [newOrder[idx], newOrder[target]] = [newOrder[target], newOrder[idx]];
    try {
      await api.post(`/api/classroom/decks/${did}/slides/_reorder`, { order: newOrder });
      await load();
    } catch (e: any) {
      toast.show(e?.detail || "순서 변경 실패", "error");
    }
  };

  if (loading) return <div className="text-text-tertiary">로딩 중...</div>;
  if (!deck) return null;

  const active = deck.slides.find((s) => s.id === activeSlide) ?? deck.slides[0];
  const canWrite = deck.permission.can_write && !deck.is_archived;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
        <Link
          href={`/classroom/${cid}/decks`}
          className="text-caption text-text-tertiary hover:text-accent inline-flex items-center gap-1"
        >
          <ArrowLeft size={12} /> 프리젠테이션 목록
        </Link>
        <div className="flex items-center gap-2 text-caption text-text-tertiary">
          <Presentation size={13} />
          <span>{deck.title}</span>
          <span>·</span>
          <span>만든이 {deck.owner_name || `#${deck.owner_id}`}</span>
          <span>·</span>
          <span>내 권한: <b className="text-accent">{deck.permission.role || "없음"}</b></span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-4">
        {/* 슬라이드 썸네일 list */}
        <aside className="bg-bg-primary border border-border-default rounded-lg p-2 space-y-1 max-h-[80vh] overflow-y-auto">
          <div className="flex items-center justify-between px-2 py-1 mb-1">
            <span className="text-caption font-semibold text-text-secondary">
              슬라이드 ({deck.slides.length})
            </span>
            {canWrite && (
              <button
                onClick={addSlide}
                title="새 슬라이드"
                className="p-1 text-accent hover:bg-accent-light rounded"
              >
                <Plus size={14} />
              </button>
            )}
          </div>
          {deck.slides.map((s, i) => {
            const isActive = active && s.id === active.id;
            return (
              <div
                key={s.id}
                className={`group flex items-stretch gap-1 ${
                  isActive ? "ring-2 ring-accent" : ""
                } rounded`}
              >
                <button
                  type="button"
                  onClick={() => setActiveSlide(s.id)}
                  className={`flex-1 flex flex-col items-center justify-center px-2 py-3 rounded text-left transition ${
                    isActive ? "bg-accent-light" : "hover:bg-bg-secondary"
                  }`}
                >
                  <div className="text-[10px] text-text-tertiary mb-1">{i + 1}</div>
                  <div className="text-caption text-text-primary text-center truncate w-full">
                    {s.title || `슬라이드 ${i + 1}`}
                  </div>
                </button>
                {canWrite && (
                  <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 px-1 py-1">
                    <button
                      onClick={() => moveSlide(i, -1)}
                      disabled={i === 0}
                      className="text-text-tertiary hover:text-accent disabled:opacity-30 p-0.5"
                      title="위로"
                    >
                      <ChevronUp size={11} />
                    </button>
                    <button
                      onClick={() => moveSlide(i, 1)}
                      disabled={i === deck.slides.length - 1}
                      className="text-text-tertiary hover:text-accent disabled:opacity-30 p-0.5"
                      title="아래로"
                    >
                      <ChevronDown size={11} />
                    </button>
                    <button
                      onClick={() => deleteSlide(s.id)}
                      disabled={deck.slides.length <= 1}
                      className="text-text-tertiary hover:text-status-error disabled:opacity-30 p-0.5"
                      title="삭제"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </aside>

        {/* 메인 편집 영역 */}
        <main className="bg-bg-primary border border-border-default rounded-lg min-h-[60vh] flex flex-col">
          {active ? (
            <div className="flex-1 flex items-center justify-center bg-white aspect-video relative">
              <div className="text-text-tertiary text-center px-6 py-10">
                <Presentation size={36} className="mx-auto opacity-30 mb-3" />
                <div className="text-body font-medium mb-1">
                  슬라이드 #{active.order + 1}: {active.title}
                </div>
                <div className="text-caption">
                  본문 편집기는 Phase P2 (TipTap) + Phase P3 (Yjs 동시 편집)에서
                  들어갑니다.
                </div>
                <div className="text-[11px] mt-3 text-text-tertiary">
                  현재는 슬라이드 추가·삭제·순서 변경까지 작동.
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-text-tertiary">
              슬라이드가 없습니다.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
