"use client";

/**
 * 화이트보드 — 학생 참여 페이지 (WhiteboardCanvas 공유 컴포넌트).
 * 강좌 글의 화이트보드 첨부 클릭으로 진입.
 */

import { useParams } from "next/navigation";
import { WhiteboardCanvas } from "@/components/whiteboard/WhiteboardCanvas";

export default function StudentWhiteboardPage() {
  const params = useParams<{ wid: string }>();
  const wid = Number(params.wid);

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
      <WhiteboardCanvas whiteboardId={wid} />
    </div>
  );
}
