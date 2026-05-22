"use client";

/**
 * 프리젠테이션 deck 편집기 — Google Slides 식 layout.
 *
 *  ┌──────┬──────────────────────────────┐
 *  │ 썸네 │  active slide 본문 편집기      │
 *  │ 일   │  (TipTap × Yjs fragment)     │
 *  │ list │                              │
 *  └──────┴──────────────────────────────┘
 *
 * Yjs 통합:
 * - HocuspocusProvider 한 번만 (name=`deck-{deckId}`)
 * - 같은 Y.Doc 공유, slide마다 fragment "slide-{sid}"
 * - 슬라이드 추가/삭제/순서는 backend API + load() 새로고침
 *   (deck slide list 자체도 Y.Doc 동기화는 향후 — 현재는 DB가 진실)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { HocuspocusProvider, WebSocketStatus } from "@hocuspocus/provider";
import * as Y from "yjs";
import { Plus, Trash2, ChevronUp, ChevronDown, Wifi, WifiOff, Loader2, Palette } from "lucide-react";
import { api } from "@/lib/api/client";
import { SlideEditor } from "./SlideEditor";
import { ThemePicker } from "./ThemePicker";
import { getTheme } from "./themes";
import ActiveUserBanner from "@/components/collab/ActiveUserBanner";

const DEFAULT_HOCUSPOCUS_URL =
  process.env.NEXT_PUBLIC_HOCUSPOCUS_URL || "ws://localhost:1234";

interface Slide {
  id: number;
  presentation_id: number;
  order: number;
  title: string | null;
}

interface DeckEditorProps {
  deckId: number;
  slides: Slide[];
  canWrite: boolean;
  userName: string;
  userId: number;
  /** deck.settings.theme_id — 디자인 테마. 없으면 minimal. */
  themeId?: string | null;
  /** 슬라이드 추가/삭제/순서 변경 후 부모가 reload */
  onReload: () => void;
  hocuspocusUrl?: string;
}

export function DeckEditor({
  deckId, slides, canWrite, userName, userId, themeId,
  onReload, hocuspocusUrl = DEFAULT_HOCUSPOCUS_URL,
}: DeckEditorProps) {
  const [activeSlideId, setActiveSlideId] = useState<number | null>(
    slides[0]?.id ?? null,
  );
  const [status, setStatus] = useState<WebSocketStatus>(WebSocketStatus.Connecting);
  const [authError, setAuthError] = useState<string | null>(null);
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [activeCount, setActiveCount] = useState(0);

  const currentTheme = getTheme(themeId);

  const pickTheme = async (newId: string) => {
    try {
      await api.put(`/api/classroom/decks/${deckId}`, {
        settings: { theme_id: newId },
      });
      onReload();
    } catch (e: any) {
      alert(e?.detail || "테마 변경 실패");
    }
  };

  // active slide 동기화 — slides prop 변경 시 첫 슬라이드 자동 선택 (삭제 등)
  useEffect(() => {
    if (slides.length === 0) {
      setActiveSlideId(null);
      return;
    }
    if (!slides.find((s) => s.id === activeSlideId)) {
      setActiveSlideId(slides[0].id);
    }
  }, [slides, activeSlideId]);

  // Y.Doc + Provider — deck 단위 1개 (deckId 바뀌면 새로)
  const { doc, provider } = useMemo(() => {
    const yDoc = new Y.Doc();
    const prov = new HocuspocusProvider({
      url: hocuspocusUrl,
      name: `deck-${deckId}`,
      document: yDoc,
      async token() {
        await api.ensureFreshToken().catch(() => false);
        return localStorage.getItem("access_token") ?? "";
      },
      onStatus: ({ status: s }) => setStatus(s),
      onAuthenticationFailed: ({ reason }) => {
        setAuthError(reason || "인증 실패");
      },
    });
    return { doc: yDoc, provider: prov };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId, hocuspocusUrl]);

  useEffect(() => {
    return () => {
      try { provider.destroy(); } catch {}
      try { doc.destroy(); } catch {}
    };
  }, [doc, provider]);

  // Awareness 사용자 수 추적 (20명+ 시 banner 표시용)
  useEffect(() => {
    const aw = (provider as any).awareness;
    if (!aw) return;
    const update = () => {
      try {
        setActiveCount(aw.getStates()?.size ?? 0);
      } catch { /* noop */ }
    };
    aw.on("change", update);
    update();
    return () => {
      try { aw.off("change", update); } catch { /* noop */ }
    };
  }, [provider]);

  // 14분 token refresh
  useEffect(() => {
    const t = setInterval(() => {
      api.ensureFreshToken().catch(() => undefined);
    }, 14 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  const addSlide = useCallback(async () => {
    try {
      await api.post(`/api/classroom/decks/${deckId}/slides`, {
        title: `슬라이드 ${slides.length + 1}`,
      });
      onReload();
    } catch (e: any) {
      alert(e?.detail || "추가 실패");
    }
  }, [deckId, slides.length, onReload]);

  const deleteSlide = useCallback(async (sid: number) => {
    if (!confirm("이 슬라이드를 삭제합니까?")) return;
    try {
      await api.delete(`/api/classroom/decks/slides/${sid}`);
      onReload();
    } catch (e: any) {
      alert(e?.detail || "삭제 실패");
    }
  }, [onReload]);

  const moveSlide = useCallback(async (idx: number, dir: -1 | 1) => {
    const newOrder = slides.map((s) => s.id);
    const target = idx + dir;
    if (target < 0 || target >= newOrder.length) return;
    [newOrder[idx], newOrder[target]] = [newOrder[target], newOrder[idx]];
    try {
      await api.post(`/api/classroom/decks/${deckId}/slides/_reorder`, {
        order: newOrder,
      });
      onReload();
    } catch (e: any) {
      alert(e?.detail || "순서 변경 실패");
    }
  }, [deckId, slides, onReload]);

  if (authError) {
    return (
      <div className="border border-status-error bg-red-50 rounded-lg p-6 text-center">
        <div className="text-status-error font-medium mb-2">협업 서버 인증 실패</div>
        <div className="text-caption text-text-secondary mb-4">{authError}</div>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover"
        >
          페이지 새로고침
        </button>
      </div>
    );
  }

  const active = slides.find((s) => s.id === activeSlideId) ?? slides[0];

  return (
    <>
      {activeCount >= 20 && (
        <div className="mb-2">
          <ActiveUserBanner count={activeCount} />
        </div>
      )}
    <div className="grid grid-cols-1 lg:grid-cols-[210px_1fr] gap-4 h-[calc(100vh-220px)] min-h-[500px]">
      {/* 좌측 썸네일 list */}
      <aside className="bg-bg-primary border border-border-default rounded-lg p-2 overflow-y-auto">
        <div className="flex items-center justify-between px-2 py-1 mb-1">
          <span className="text-caption font-semibold text-text-secondary">
            슬라이드 ({slides.length})
          </span>
          <StatusBadge status={status} />
        </div>
        {slides.map((s, i) => {
          const isActive = active && s.id === active.id;
          return (
            <div
              key={s.id}
              className={`group flex items-stretch gap-1 mb-1 rounded ${
                isActive ? "ring-2 ring-accent" : ""
              }`}
            >
              <button
                type="button"
                onClick={() => setActiveSlideId(s.id)}
                className={`flex-1 px-2 py-3 rounded text-left transition ${
                  isActive ? "bg-accent-light" : "hover:bg-bg-secondary"
                }`}
              >
                <div className="text-[10px] text-text-tertiary mb-1">{i + 1}</div>
                <div className="text-caption text-text-primary truncate">
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
                  ><ChevronUp size={11} /></button>
                  <button
                    onClick={() => moveSlide(i, 1)}
                    disabled={i === slides.length - 1}
                    className="text-text-tertiary hover:text-accent disabled:opacity-30 p-0.5"
                    title="아래로"
                  ><ChevronDown size={11} /></button>
                  <button
                    onClick={() => deleteSlide(s.id)}
                    disabled={slides.length <= 1}
                    className="text-text-tertiary hover:text-status-error disabled:opacity-30 p-0.5"
                    title="삭제"
                  ><Trash2 size={11} /></button>
                </div>
              )}
            </div>
          );
        })}
        {canWrite && (
          <button
            onClick={addSlide}
            className="w-full flex items-center justify-center gap-1 py-2 mt-2 text-caption text-text-secondary border-2 border-dashed border-border-default rounded hover:border-accent hover:text-accent transition"
          >
            <Plus size={12} /> 슬라이드 추가
          </button>
        )}
        {canWrite && (
          <button
            onClick={() => setShowThemePicker(true)}
            className="w-full flex items-center justify-center gap-1 py-2 mt-1 text-caption text-text-secondary border border-border-default rounded hover:bg-bg-secondary transition"
            title={`현재 테마: ${currentTheme.label}`}
          >
            <Palette size={12} /> {currentTheme.label}
          </button>
        )}
      </aside>

      {/* 우측 메인 — active slide editor */}
      <main className="overflow-hidden">
        {active ? (
          <SlideEditor
            key={active.id}
            doc={doc}
            provider={provider}
            fragmentName={`slide-${active.id}`}
            canWrite={canWrite}
            userName={userName}
            userId={userId}
            themeId={themeId}
          />
        ) : (
          <div className="bg-bg-primary border border-border-default rounded-lg h-full flex items-center justify-center text-text-tertiary">
            슬라이드가 없습니다.
          </div>
        )}
      </main>

      {showThemePicker && (
        <ThemePicker
          current={themeId}
          onPick={pickTheme}
          onClose={() => setShowThemePicker(false)}
        />
      )}
    </div>
    </>
  );
}

function StatusBadge({ status }: { status: WebSocketStatus }) {
  if (status === WebSocketStatus.Connected) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-status-success">
        <Wifi size={10} />
      </span>
    );
  }
  if (status === WebSocketStatus.Connecting) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-text-tertiary">
        <Loader2 size={10} className="animate-spin" />
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-status-warning">
      <WifiOff size={10} />
    </span>
  );
}
