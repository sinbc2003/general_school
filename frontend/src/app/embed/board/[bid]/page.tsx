"use client";

/**
 * 보드 — 새 창 풀스크린 (사이드바·헤더 없음, Padlet처럼 전체 화면).
 * 프로젝터·듀얼 모니터 표시용. embed layout이 인증 처리.
 */

import { useParams } from "next/navigation";
import { BoardView } from "@/components/board/BoardView";

export default function EmbedBoardPage() {
  const params = useParams<{ bid: string }>();
  return (
    <div className="h-full w-full overflow-y-auto">
      <BoardView boardId={Number(params.bid)} fullscreen />
    </div>
  );
}
