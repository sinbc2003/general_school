"use client";

/**
 * 화이트보드 — 새 창 풀스크린 (사이드바·헤더 없음).
 * 프로젝터·전자칠판 표시용. embed layout이 인증 처리.
 */

import { useParams } from "next/navigation";
import { WhiteboardCanvas } from "@/components/whiteboard/WhiteboardCanvas";

export default function EmbedWhiteboardPage() {
  const params = useParams<{ wid: string }>();
  return (
    <div className="h-full w-full overflow-y-auto">
      <WhiteboardCanvas whiteboardId={Number(params.wid)} fullscreen />
    </div>
  );
}
