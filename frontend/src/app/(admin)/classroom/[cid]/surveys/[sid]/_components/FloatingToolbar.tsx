"use client";

/**
 * 우측 sticky 플로팅 툴바 — 질문 카드 옆에 sticky.
 *
 * 디자인 일치를 위해 자리만 차지하던 disabled 버튼들(섹션·이미지·비디오·제목)은
 * 제거. 실제 동작하는 + 버튼 하나만 큰 원형으로 둠.
 */

import { Plus } from "lucide-react";

interface Props {
  onAddQuestion: () => void;
}

export function FloatingToolbar({ onAddQuestion }: Props) {
  return (
    <div className="sticky top-4 self-start ml-3 hidden md:flex">
      <button
        type="button"
        onClick={onAddQuestion}
        title="질문 추가"
        aria-label="질문 추가"
        className="w-11 h-11 rounded-full bg-[#673ab7] text-white shadow-md hover:bg-[#5e35b1] flex items-center justify-center transition-colors"
      >
        <Plus size={20} />
      </button>
    </div>
  );
}
