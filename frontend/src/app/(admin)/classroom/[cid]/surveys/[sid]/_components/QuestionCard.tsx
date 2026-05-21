"use client";

/**
 * 빌더에서 한 질문을 보여주는 카드 — Google Forms 식.
 *
 * 좌측 보라색 강조 보더, 큰 흰 카드, 우상단에 question 타입 표시.
 * canEdit이면 드래그 핸들·삭제 버튼 노출 (draft 상태에서만).
 */

import { Trash2 } from "lucide-react";
import { QuestionPreview } from "./QuestionPreview";
import { TYPE_LABELS, type Question } from "./_types";

interface QuestionCardProps {
  q: Question;
  index: number;
  canEdit: boolean;
  onDelete: () => void;
}

export function QuestionCard({ q, index, canEdit, onDelete }: QuestionCardProps) {
  return (
    // Google Forms 식 — 흰 카드 + 옅은 그림자. 좌측 보라색 두꺼운 보더(active 강조용)는
    // 빌더에선 항상 표시 — 편집 가능성 시그널.
    <div
      className="bg-white rounded-lg shadow-sm overflow-hidden"
      style={canEdit ? { borderLeft: "6px solid #673ab7" } : undefined}
    >
      <div className="px-6 py-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            {/* 진짜 드래그 핸들은 SortableQuestionRow의 좌측 GripVertical (hover 시 노출).
                중앙 상단의 장식용 핸들은 무동작이라 제거됨. */}
            <div className="text-[15.5px] text-text-primary whitespace-pre-wrap leading-snug">
              <span className="text-text-tertiary mr-2">{index + 1}.</span>
              {q.question_text}
              {q.is_required && <span className="text-status-error ml-1">*</span>}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-[11px] px-2 py-0.5 bg-[#ede7f6] text-[#673ab7] rounded font-medium">
              {TYPE_LABELS[q.question_type]}
            </span>
            {canEdit && (
              <button
                onClick={onDelete}
                className="text-text-tertiary hover:text-status-error p-1 rounded hover:bg-bg-secondary"
                title="질문 삭제"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>
        <div className="text-text-secondary">
          <QuestionPreview q={q} />
        </div>
      </div>
    </div>
  );
}
