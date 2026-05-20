"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api/client";
import { PresentMode } from "@/components/decks/PresentMode";

interface Slide { id: number; order: number; title: string | null; }
interface DeckDetail {
  id: number;
  title: string;
  slides: Slide[];
  settings: { theme_id?: string };
}

export default function PresentStudentPage() {
  const params = useParams();
  const router = useRouter();
  const cid = Number(params.cid);
  const did = Number(params.did);

  const [deck, setDeck] = useState<DeckDetail | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api.get<DeckDetail>(`/api/classroom/decks/${did}`);
      setDeck(d);
    } catch {
      router.push(`/s/classroom/${cid}/decks/${did}`);
    }
  }, [did, cid, router]);

  useEffect(() => { load(); }, [load]);

  if (!deck) return <div className="text-text-tertiary p-6">로딩 중...</div>;

  return (
    <PresentMode
      deckId={did}
      deckTitle={deck.title}
      slides={deck.slides}
      themeId={deck.settings?.theme_id}
      onExit={() => router.push(`/s/classroom/${cid}/decks/${did}`)}
    />
  );
}
