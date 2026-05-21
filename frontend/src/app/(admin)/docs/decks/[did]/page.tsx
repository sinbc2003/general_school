"use client";

/**
 * 관리자/교사용 단독 프리젠테이션 편집기 (course_id 없음).
 * 풀스크린 레이아웃.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Play, Sparkles } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAuth } from "@/lib/auth-context";
import { DeckEditor } from "@/components/decks/DeckEditor";
import { useAutoCollapseSidebar } from "@/lib/hooks/use-auto-collapse-sidebar";
import { AIAssistantPanel } from "@/components/tool-ai/AIAssistantPanel";
import type { ApplyHandler } from "@/components/tool-ai/types";

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
  permission: {
    can_read: boolean;
    can_write: boolean;
    can_share: boolean;
    role: string | null;
  };
  updated_at: string | null;
}

export default function AdminStandaloneDeckPage() {
  useAutoCollapseSidebar();
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const did = Number(params.did);

  const [deck, setDeck] = useState<DeckDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAI, setShowAI] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get<DeckDetail>(`/api/classroom/decks/${did}`);
      setDeck(d);
    } catch (e: any) {
      alert(e?.detail || "프리젠테이션 조회 실패");
      router.push("/drive");
    } finally { setLoading(false); }
  }, [did, router]);

  useEffect(() => { load(); }, [load]);

  const aiApply: ApplyHandler = async (call) => {
    if (call.name === "slide_add") {
      const title = String(call.arguments.title || "새 슬라이드").trim();
      await api.post(`/api/classroom/decks/${did}/slides`, { title });
      await load();
    }
  };

  if (loading) return <div className="text-text-tertiary">로딩 중...</div>;
  if (!deck) return null;

  return (
    <div className="w-full">
      <div className="mb-3 flex items-center justify-between gap-2 flex-wrap">
        <Link
          href="/drive"
          className="text-caption text-text-tertiary hover:text-accent inline-flex items-center gap-1"
        >
          <ArrowLeft size={12} /> 내 드라이브
        </Link>
        <div className="flex items-center gap-2 text-caption text-text-tertiary flex-wrap">
          <span>만든이 <b>{deck.owner_name || `#${deck.owner_id}`}</b></span>
          <span>· {deck.slide_count}장</span>
          <span>· 권한: <b className="text-accent">{deck.permission.role || "없음"}</b></span>
          <Link
            href={`/docs/decks/${did}/present`}
            className="ml-2 inline-flex items-center gap-1 px-2 py-1 bg-accent text-white rounded text-[11px] hover:opacity-90"
          >
            <Play size={11} /> 발표 모드
          </Link>
          {deck.permission.can_write && !deck.is_archived && (
            <button
              type="button"
              onClick={() => setShowAI(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[#673ab7] border border-[#e8def8] rounded text-[11.5px] hover:bg-[#f3e5f5]"
              title="AI 도우미 (슬라이드 자동 생성)"
            >
              <Sparkles size={11} /> AI
            </button>
          )}
        </div>
      </div>

      <h1 className="text-title text-text-primary mb-3">{deck.title}</h1>

      {user && (
        <DeckEditor
          deckId={did}
          slides={deck.slides || []}
          userId={user.id}
          userName={user.name}
          canWrite={deck.permission.can_write && !deck.is_archived}
          onReload={load}
        />
      )}

      <AIAssistantPanel
        toolKind="slide"
        toolId={did}
        applyHandler={aiApply}
        getCurrentContent={() => {
          const lines = [`Deck 제목: ${deck.title}`, `슬라이드 ${deck.slide_count}개:`];
          (deck.slides || []).forEach((s, i) => {
            lines.push(`${i + 1}. ${s.title || "(제목 없음)"}`);
          });
          return lines.join("\n");
        }}
        open={showAI}
        onClose={() => setShowAI(false)}
      />
    </div>
  );
}
