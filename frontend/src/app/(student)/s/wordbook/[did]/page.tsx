"use client";

/**
 * 단어장 — 학생 학습 페이지 (StudyView 공유 컴포넌트).
 */

import { useParams, useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { StudyView } from "@/components/wordbook/StudyView";

export default function StudentWordbookStudyPage() {
  const params = useParams<{ did: string }>();
  const router = useRouter();
  const did = Number(params.did);

  return (
    <div className="p-6">
      <button
        onClick={() => router.push("/s/wordbook")}
        className="inline-flex items-center gap-1 text-caption text-text-tertiary hover:text-text-primary mb-4"
      >
        <ChevronLeft size={14} /> 단어장 홈
      </button>
      <StudyView deckId={did} />
    </div>
  );
}
