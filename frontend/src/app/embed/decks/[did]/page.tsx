"use client";

/**
 * 슬라이드(덱) fullscreen 임베드.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api/client";
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
  title: string;
  is_archived: boolean;
  slides: Slide[];
  settings: { theme_id?: string; [k: string]: any };
  permission: Permission;
}

export default function EmbedDeckPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const did = Number(params.did);

  const [deck, setDeck] = useState<DeckDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const d = await api.get<DeckDetail>(`/api/classroom/decks/${did}`);
      setDeck(d);
    } catch (e: any) {
      toast.show(e?.detail || "deck 조회 실패", "error");
      router.push("/drive");
    } finally {
      setLoading(false);
    }
  }, [did, router, toast]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-6 text-text-tertiary">로딩 중...</div>;
  if (!deck) return null;
  if (!deck.permission.can_read) {
    return (
      <div className="h-full w-full flex items-center justify-center text-text-tertiary">
        이 슬라이드에 대한 접근 권한이 없습니다.
      </div>
    );
  }

  const canWrite = deck.permission.can_write && !deck.is_archived;

  return (
    <div className="h-full w-full flex flex-col">
      <div className="flex-shrink-0 px-4 py-2 bg-white border-b border-border-default text-caption text-text-secondary flex items-center gap-2">
        <span className="font-medium text-text-primary truncate">{deck.title}</span>
        <span className="text-text-tertiary">·</span>
        <span>권한: <b className="text-accent">{deck.permission.role || "없음"}</b></span>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden p-3">
        {user && (
          <DeckEditor
            deckId={did}
            slides={deck.slides}
            canWrite={canWrite}
            userName={user.name}
            userId={user.id}
            themeId={deck.settings?.theme_id}
            onReload={load}
          />
        )}
      </div>
    </div>
  );
}
