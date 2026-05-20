"use client";

/**
 * 학생용 프리젠테이션 편집기 — Yjs 동시 편집 통합.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Presentation, Play } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/ui/Toast";
import { DeckEditor } from "@/components/decks/DeckEditor";

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

export default function StudentCourseDeckEditorPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const cid = Number(params.cid);
  const did = Number(params.did);

  const [deck, setDeck] = useState<DeckDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const d = await api.get<DeckDetail>(`/api/classroom/decks/${did}`);
      setDeck(d);
    } catch (e: any) {
      toast.show(e?.detail || "deck 조회 실패", "error");
      router.push(`/s/classroom/${cid}/decks`);
    } finally {
      setLoading(false);
    }
  }, [did, cid, router, toast]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="text-text-tertiary">로딩 중...</div>;
  if (!deck) return null;

  const canWrite = deck.permission.can_write && !deck.is_archived;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
        <Link
          href={`/s/classroom/${cid}/decks`}
          className="text-caption text-text-tertiary hover:text-accent inline-flex items-center gap-1"
        >
          <ArrowLeft size={12} /> 프리젠테이션 목록
        </Link>
        <div className="flex items-center gap-2 text-caption text-text-tertiary flex-wrap">
          <Presentation size={13} />
          <b className="text-text-primary">{deck.title}</b>
          <span>·</span>
          <span>내 권한: <b className="text-accent">{deck.permission.role || "없음"}</b></span>
          <Link
            href={`/s/classroom/${cid}/decks/${did}/present`}
            className="ml-2 inline-flex items-center gap-1 px-3 py-1 bg-accent text-white rounded text-[11.5px] hover:bg-accent-hover"
            title="발표 모드"
          >
            <Play size={11} /> 발표
          </Link>
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
    </div>
  );
}
