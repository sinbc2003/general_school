"use client";

/**
 * 단어장 — 학생 홈. 최근 학습한 덱 + 공개 단어장.
 * (강좌 글에 첨부된 비공개 덱은 첨부 클릭으로 진입)
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BookA, Loader2, Clock, Globe } from "lucide-react";
import { api } from "@/lib/api/client";

interface DeckItem {
  id: number;
  title: string;
  description?: string | null;
  lang_pair: string;
  card_count: number;
  studied_cards?: number;
  last_studied_at?: string | null;
}

export default function StudentWordbookHome() {
  const router = useRouter();
  const [recent, setRecent] = useState<DeckItem[] | null>(null);
  const [pub, setPub] = useState<DeckItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ recent: DeckItem[]; public: DeckItem[] }>(
          "/api/tools/wordbook/study-home",
        );
        if (!cancelled) {
          setRecent(res.recent || []);
          setPub(res.public || []);
        }
      } catch {
        if (!cancelled) setRecent([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (recent === null) {
    return (
      <div className="flex items-center justify-center py-24 text-text-tertiary">
        <Loader2 size={20} className="animate-spin mr-2" /> 불러오는 중...
      </div>
    );
  }

  const DeckCard = ({ d, sub }: { d: DeckItem; sub?: string }) => (
    <button
      onClick={() => router.push(`/s/wordbook/${d.id}`)}
      className="text-left border border-border-default rounded-xl p-4 bg-bg-primary hover:border-sky-300 hover:shadow-sm transition w-full"
    >
      <div className="text-body font-semibold truncate">{d.title}</div>
      {d.description && (
        <div className="text-caption text-text-tertiary line-clamp-1 mt-0.5">{d.description}</div>
      )}
      <div className="text-caption text-text-secondary mt-1.5">
        {d.card_count}개 단어{sub ? ` · ${sub}` : ""}
      </div>
    </button>
  );

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-title font-semibold flex items-center gap-2 mb-1">
        <BookA size={22} className="text-sky-600" /> 단어장
      </h1>
      <p className="text-caption text-text-tertiary mb-6">
        플래시카드 · 4지선다 · 스펠 타이핑으로 학습 — 틀린 단어는 자동으로 다시 나옵니다
      </p>

      {recent.length > 0 && (
        <section className="mb-7">
          <h2 className="text-body font-semibold flex items-center gap-1.5 mb-3">
            <Clock size={15} className="text-text-tertiary" /> 최근 학습
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {recent.map((d) => (
              <DeckCard key={d.id} d={d} sub={`${d.studied_cards ?? 0}개 학습함`} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-body font-semibold flex items-center gap-1.5 mb-3">
          <Globe size={15} className="text-emerald-600" /> 공개 단어장
        </h2>
        {pub.length === 0 ? (
          <div className="text-center py-12 text-text-tertiary text-caption border border-dashed border-border-default rounded-xl">
            아직 공개된 단어장이 없습니다. 수업 글에 첨부된 단어장으로 학습해보세요.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {pub.map((d) => <DeckCard key={d.id} d={d} />)}
          </div>
        )}
      </section>
    </div>
  );
}
