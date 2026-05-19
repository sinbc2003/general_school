"use client";

/**
 * 빌더에서 한 질문을 보여주는 카드.
 *
 * canEdit이면 드래그 핸들·삭제 버튼 노출 (draft 상태에서만).
 */

import { GripVertical, Trash2 } from "lucide-react";
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
    <div className="border border-border-default rounded-lg p-4 bg-bg-primary">
      <div className="flex items-center gap-2 mb-2">
        {canEdit && <GripVertical size={12} className="text-text-tertiary" />}
        <span className="text-caption text-text-tertiary">Q{index + 1}.</span>
        <span className="text-[10px] px-1.5 py-0.5 bg-cream-200 text-text-secondary rounded">
          {TYPE_LABELS[q.question_type]}
        </span>
        {q.is_required && <span className="text-status-error text-caption">*</span>}
        <div className="flex-1" />
        {canEdit && (
          <button onClick={onDelete} className="text-text-tertiary hover:text-status-error">
            <Trash2 size={12} />
          </button>
        )}
      </div>
      <div className="text-body text-text-primary mb-2 whitespace-pre-wrap">
        {q.question_text}
      </div>
      <QuestionPreview q={q} />
    </div>
  );
}
