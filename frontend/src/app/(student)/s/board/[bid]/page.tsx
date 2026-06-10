"use client";

/**
 * 보드 — 학생 참여 페이지 (BoardView 공유 컴포넌트).
 * 강좌 글의 보드 첨부 클릭으로 진입.
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StickyNote } from "lucide-react";
import { api } from "@/lib/api/client";
import { BoardView } from "@/components/board/BoardView";

export default function StudentBoardPage() {
  const params = useParams<{ bid: string }>();
  const bid = Number(params.bid);
  const [title, setTitle] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ title: string }>(`/api/classroom/boards/${bid}`);
        if (!cancelled) setTitle(res.title);
      } catch { /* BoardView가 에러 표시 */ }
    })();
    return () => { cancelled = true; };
  }, [bid]);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {title && (
        <h1 className="text-title font-semibold flex items-center gap-2 mb-4">
          <StickyNote size={20} className="text-amber-600" /> {title}
        </h1>
      )}
      <BoardView boardId={bid} />
    </div>
  );
}
