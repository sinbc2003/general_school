"use client";

/**
 * 보드 — 학생 참여 페이지 (BoardView 공유 컴포넌트, 월 헤더 포함).
 * 강좌 글의 보드 첨부 클릭으로 진입.
 */

import { useParams } from "next/navigation";
import { BoardView } from "@/components/board/BoardView";

export default function StudentBoardPage() {
  const params = useParams<{ bid: string }>();
  const bid = Number(params.bid);

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
      <BoardView boardId={bid} />
    </div>
  );
}
