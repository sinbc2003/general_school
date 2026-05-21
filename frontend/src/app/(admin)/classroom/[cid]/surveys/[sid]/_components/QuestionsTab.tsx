"use client";

/**
 * 질문 탭 — Google Forms 식 빌더 본체.
 *
 * - 제목/설명 카드 (상단 10px 보라 바)
 * - 드래그 정렬 가능한 질문 카드 list (draft + canEdit)
 * - "질문 추가" 큰 버튼 (canEdit)
 * - 활성/마감 상태에서는 잠금 안내
 */

import { useState } from "react";
import { Plus, GripVertical, Lock as LockIcon } from "lucide-react";
import { api } from "@/lib/api/client";
import { QuestionCard } from "./QuestionCard";
import { AddQuestionModal } from "./AddQuestionModal";
import type { Question } from "./_types";
import {
  DndContext, DragEndEvent, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";


interface Props {
  sid: number;
  survey: {
    title: string;
    description: string | null;
    questions: Question[];
    status: "draft" | "active" | "closed";
  };
  canEdit: boolean;
  titleDraft: string;
  setTitleDraft: (v: string) => void;
  saveTitle: () => Promise<void>;
  onUpdateMeta: (patch: Record<string, unknown>) => Promise<void>;
  onReorder: (ids: number[]) => Promise<void>;
  onDeleteQuestion: (qid: number) => Promise<void>;
  onReload: () => Promise<void>;
}


export function QuestionsTab({
  sid, survey, canEdit, titleDraft, setTitleDraft, saveTitle,
  onUpdateMeta, onReorder, onDeleteQuestion, onReload,
}: Props) {
  const [showAddQ, setShowAddQ] = useState(false);
  const isDraft = survey.status === "draft";

  return (
    <div>
      {/* 제목 카드 — Google Forms 식 (보라 상단 10px 바 + 큰 제목) */}
      <div
        className="bg-white rounded-lg shadow-sm overflow-hidden mb-3"
        style={{ borderTop: "10px solid #673ab7" }}
      >
        <div className="px-6 py-5">
          <input
            type="text"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={saveTitle}
            disabled={!canEdit}
            placeholder="설문지 제목"
            className="w-full text-[28px] font-normal bg-transparent border-0 outline-none focus:border-b-2 focus:border-[#673ab7] disabled:text-text-tertiary pb-1"
          />
          <input
            type="text"
            defaultValue={survey.description || ""}
            disabled={!canEdit}
            placeholder="설문지 설명"
            onBlur={(e) => {
              if (e.target.value !== (survey.description || "")) {
                onUpdateMeta({ description: e.target.value });
              }
            }}
            className="w-full text-[13px] text-text-secondary bg-transparent border-0 outline-none focus:border-b focus:border-[#673ab7] mt-3 pb-1"
          />
        </div>
      </div>

      {/* 질문 카드들 */}
      <div className="space-y-3 mb-3">
        {survey.questions.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm py-16 text-center text-caption text-text-tertiary">
            아직 질문이 없습니다. {canEdit && "[질문 추가] 버튼으로 시작하세요."}
          </div>
        ) : canEdit ? (
          <SortableQuestions
            questions={survey.questions}
            onReorder={onReorder}
            onDelete={onDeleteQuestion}
          />
        ) : (
          survey.questions.map((q, idx) => (
            <QuestionCard
              key={q.id}
              q={q}
              index={idx}
              canEdit={false}
              onDelete={() => onDeleteQuestion(q.id)}
            />
          ))
        )}
      </div>

      {canEdit && (
        <button
          onClick={() => setShowAddQ(true)}
          className="w-full bg-white rounded-lg shadow-sm py-3.5 text-caption text-[#673ab7] hover:bg-[#ede7f6] font-medium flex items-center justify-center gap-1.5"
        >
          <Plus size={16} /> 질문 추가
        </button>
      )}

      {!canEdit && !isDraft && (
        <div className="mt-4 text-caption text-text-tertiary p-3 bg-white border border-border-default rounded inline-flex items-center gap-1">
          <LockIcon size={12} /> 활성/마감 상태에서는 질문을 편집할 수 없습니다. "초안으로" 되돌려서 편집하세요.
        </div>
      )}

      {showAddQ && canEdit && (
        <AddQuestionModal
          sid={sid}
          onClose={() => setShowAddQ(false)}
          onSaved={() => { setShowAddQ(false); onReload(); }}
        />
      )}
    </div>
  );
}


function SortableQuestions({
  questions, onReorder, onDelete,
}: {
  questions: Question[];
  onReorder: (ids: number[]) => Promise<void>;
  onDelete: (id: number) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = questions.findIndex((q) => q.id === Number(active.id));
    const newIdx = questions.findIndex((q) => q.id === Number(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(questions, oldIdx, newIdx);
    onReorder(reordered.map((q) => q.id));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={questions.map((q) => q.id)} strategy={verticalListSortingStrategy}>
        {questions.map((q, idx) => (
          <SortableQuestionRow key={q.id} q={q} index={idx} onDelete={() => onDelete(q.id)} />
        ))}
      </SortableContext>
    </DndContext>
  );
}

function SortableQuestionRow({
  q, index, onDelete,
}: { q: Question; index: number; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: q.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="relative group">
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="absolute left-1 top-1/2 -translate-y-1/2 p-1 rounded text-text-tertiary hover:text-text-primary cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100"
        title="드래그로 순서 변경"
        aria-label="드래그로 순서 변경"
      >
        <GripVertical size={14} />
      </button>
      <QuestionCard q={q} index={index} canEdit onDelete={onDelete} />
    </div>
  );
}
