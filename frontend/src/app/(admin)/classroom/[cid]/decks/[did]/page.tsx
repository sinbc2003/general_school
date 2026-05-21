"use client";

/**
 * 프리젠테이션 편집기 — Yjs 동시 편집 통합.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Presentation, Play, Sparkles, ExternalLink } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/ui/Toast";
import { DeckEditor } from "@/components/decks/DeckEditor";
import { AIAssistantPanel } from "@/components/tool-ai/AIAssistantPanel";
import type { ApplyHandler } from "@/components/tool-ai/types";

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
  settings: { theme_id?: string; [k: string]: any };
  permission: Permission;
}

export default function CourseDeckEditorAdminPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const cid = Number(params.cid);
  const did = Number(params.did);

  const [deck, setDeck] = useState<DeckDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAI, setShowAI] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get<DeckDetail>(`/api/classroom/decks/${did}`);
      setDeck(d);
    } catch (e: any) {
      toast.show(e?.detail || "deck 조회 실패", "error");
      router.push(`/classroom/${cid}/decks`);
    } finally {
      setLoading(false);
    }
  }, [did, cid, router, toast]);

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

  const canWrite = deck.permission.can_write && !deck.is_archived;

  return (
    <div className="w-full">
      <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
        <Link
          href="/drive"
          className="text-caption text-text-tertiary hover:text-accent inline-flex items-center gap-1"
        >
          <ArrowLeft size={12} /> 내 드라이브
        </Link>
        <div className="flex items-center gap-2 text-caption text-text-tertiary flex-wrap">
          <Presentation size={13} />
          <b className="text-text-primary">{deck.title}</b>
          <span>·</span>
          <span>만든이 {deck.owner_name || `#${deck.owner_id}`}</span>
          <span>·</span>
          <span>내 권한: <b className="text-accent">{deck.permission.role || "없음"}</b></span>
          <Link
            href={`/classroom/${cid}/decks/${did}/present`}
            className="ml-2 inline-flex items-center gap-1 px-3 py-1 bg-accent text-white rounded text-[11.5px] hover:bg-accent-hover"
            title="발표 모드"
          >
            <Play size={11} /> 발표
          </Link>
          <button
            onClick={() => window.open(window.location.href, "_blank", "noopener,noreferrer")}
            className="ml-1 inline-flex items-center gap-1 px-2.5 py-1 text-text-tertiary border border-border-default rounded text-[11.5px] hover:bg-bg-secondary"
            title="새 창에서 열기"
          >
            <ExternalLink size={11} /> 새 창
          </button>
          {canWrite && (
            <button
              onClick={() => setShowAI(true)}
              className="ml-1 inline-flex items-center gap-1 px-2.5 py-1 text-[#673ab7] border border-[#e8def8] rounded text-[11.5px] hover:bg-[#f3e5f5]"
              title="AI 도우미 (슬라이드 자동 생성)"
            >
              <Sparkles size={11} /> AI
            </button>
          )}
        </div>
      </div>

      {user ? (
        <DeckEditor
          deckId={did}
          slides={deck.slides}
          canWrite={canWrite}
          userName={user.name}
          userId={user.id}
          themeId={deck.settings?.theme_id}
          onReload={load}
        />
      ) : (
        <div className="text-text-tertiary">사용자 정보 로딩 중...</div>
      )}

      <AIAssistantPanel
        toolKind="slide"
        toolId={did}
        applyHandler={aiApply}
        getCurrentContent={() => {
          const lines = [`Deck 제목: ${deck.title}`, `슬라이드 ${deck.slides.length}개:`];
          deck.slides.forEach((s, i) => {
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
