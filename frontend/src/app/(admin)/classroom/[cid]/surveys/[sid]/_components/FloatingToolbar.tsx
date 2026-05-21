"use client";

/**
 * Google Forms 식 우측 플로팅 툴바 — 질문 카드 옆에 sticky.
 *
 * 활성 (구현됨):
 *   - + 질문 추가
 *   - Tt 제목+설명 카드 (현 질문 카드 위로 텍스트 블록 — 미구현이라 placeholder)
 *
 * 미구현 (disabled with tooltip):
 *   - 이미지 부착
 *   - 비디오 부착
 *   - 섹션 (페이지 나누기)
 *
 * 큰 보라 + 버튼이 가장 위에 강조. 나머지는 작은 회색 아이콘.
 */

import { Plus, Type, Image as ImageIcon, Youtube, Minus } from "lucide-react";

interface Props {
  onAddQuestion: () => void;
}

export function FloatingToolbar({ onAddQuestion }: Props) {
  return (
    <div className="sticky top-4 self-start ml-3 hidden md:flex">
      <div className="bg-white rounded-full shadow-md border border-[#dadce0] py-1.5 px-1 flex flex-col items-center gap-0.5">
        <ToolButton
          onClick={onAddQuestion}
          label="질문 추가"
          accent
        >
          <Plus size={18} />
        </ToolButton>
        <ToolButton disabled label="제목 및 설명 (예정)">
          <Type size={16} />
        </ToolButton>
        <ToolButton disabled label="이미지 추가 (예정)">
          <ImageIcon size={16} />
        </ToolButton>
        <ToolButton disabled label="동영상 추가 (예정)">
          <Youtube size={16} />
        </ToolButton>
        <ToolButton disabled label="섹션 추가 (예정)">
          <Minus size={16} />
        </ToolButton>
      </div>
    </div>
  );
}

function ToolButton({
  children, onClick, disabled, label, accent,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  label: string;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
        accent
          ? "bg-[#673ab7] text-white hover:bg-[#5e35b1]"
          : disabled
          ? "text-text-tertiary opacity-50 cursor-not-allowed"
          : "text-text-secondary hover:bg-[#f3e5f5] hover:text-[#673ab7]"
      }`}
    >
      {children}
    </button>
  );
}
