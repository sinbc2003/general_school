"use client";

/**
 * 단어장 — 공유받은 덱 미리보기 (열람 전용 + 내 단어장으로 복사).
 * StudyView 재사용 — study 엔드포인트가 공유 교사에게 열람 허용.
 */

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Copy, Loader2, Share2 } from "lucide-react";
import { api } from "@/lib/api/client";
import { useToolFocusMode } from "@/lib/use-tool-focus";
import { StudyView } from "@/components/wordbook/StudyView";

export default function SharedDeckPreviewPage() {
  const params = useParams<{ did: string }>();
  const router = useRouter();
  const did = Number(params.did);
  const [duplicating, setDuplicating] = useState(false);
  useToolFocusMode();

  const duplicate = async () => {
    if (duplicating) return;
    setDuplicating(true);
    try {
      const res = await api.post<{ id: number }>(`/api/tools/wordbook/decks/${did}/duplicate`);
      router.push(`/tools/wordbook/${res.id}`);
    } catch (e: any) {
      alert(e?.detail || "사본 생성 실패");
      setDuplicating(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <Link
          href="/tools/wordbook"
          className="inline-flex items-center gap-1 text-caption text-text-tertiary hover:text-text-primary"
        >
          <ChevronLeft size={14} /> 단어장 목록
        </Link>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-caption text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-2.5 py-1">
            <Share2 size={12} /> 공유받은 단어장 — 열람 전용
          </span>
          <button
            onClick={duplicate}
            disabled={duplicating}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white rounded-lg text-caption font-medium"
          >
            {duplicating ? <Loader2 size={13} className="animate-spin" /> : <Copy size={13} />}
            내 단어장으로 복사
          </button>
        </div>
      </div>
      <StudyView deckId={did} />
    </div>
  );
}
