"use client";

/**
 * 설문 빌더 + 상태 토글 + 결과 페이지 이동.
 *
 * - status=draft: 질문 추가/편집/삭제 + 메타 편집 + Active 토글
 * - status=active: 질문 변경 잠금. 결과/공유 액션. Close 토글.
 * - status=closed: 결과 조회 + Draft로 되돌리기
 *
 * 분할 (_components/):
 *   - _types.ts: QType / Question / TYPE_LABELS
 *   - QuestionCard.tsx: 빌더 카드
 *   - QuestionPreview.tsx: 유형별 미리보기
 *   - AddQuestionModal.tsx: 질문 추가 모달
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, Plus, Trash2, BarChart3, Lock, Unlock, Archive, Pencil,
  Share2, Lock as LockIcon, Clock, GripVertical,
} from "lucide-react";
import { api } from "@/lib/api/client";
import ShareLinkModal from "@/components/classroom/ShareLinkModal";
import { QuestionCard } from "./_components/QuestionCard";
import { AddQuestionModal } from "./_components/AddQuestionModal";
import type { Question } from "./_components/_types";
import {
  DndContext, DragEndEvent, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";


interface SurveyDetail {
  id: number;
  course_id: number | null;
  author_id: number;
  author_name?: string;
  title: string;
  description: string | null;
  status: "draft" | "active" | "closed";
  is_anonymous: boolean;
  allow_multiple_responses: boolean;
  access_mode: string;
  response_edit_minutes: number;
  questions: Question[];
  is_author: boolean;
}


export default function SurveyBuilderPage() {
  const params = useParams();
  const router = useRouter();
  const cid = Number(params.cid);
  const sid = Number(params.sid);

  const [survey, setSurvey] = useState<SurveyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddQ, setShowAddQ] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [showShare, setShowShare] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await api.get<SurveyDetail>(`/api/classroom/surveys/${sid}`);
      setSurvey(s);
      setTitleDraft(s.title);
    } catch (e: any) {
      alert(e?.detail || "설문 조회 실패");
      router.push(`/classroom/${cid}/surveys`);
    } finally {
      setLoading(false);
    }
  }, [cid, sid, router]);

  useEffect(() => { load(); }, [load]);

  const updateMeta = async (patch: Partial<SurveyDetail>) => {
    try {
      await api.put(`/api/classroom/surveys/${sid}`, patch);
      await load();
    } catch (e: any) {
      alert(e?.detail || "변경 실패");
    }
  };

  const saveTitle = async () => {
    if (!titleDraft.trim() || !survey || titleDraft === survey.title) return;
    await updateMeta({ title: titleDraft.trim() });
  };

  const deleteQuestion = async (qid: number) => {
    if (!confirm("질문을 삭제합니까?")) return;
    try {
      await api.delete(`/api/classroom/surveys/questions/${qid}`);
      await load();
    } catch (e: any) {
      alert(e?.detail || "삭제 실패");
    }
  };

  const deleteSurvey = async () => {
    if (!confirm("이 설문을 삭제합니다. 응답까지 모두 사라집니다.")) return;
    try {
      await api.delete(`/api/classroom/surveys/${sid}`);
      router.push(`/classroom/${cid}/surveys`);
    } catch (e: any) {
      alert(e?.detail || "삭제 실패");
    }
  };

  if (loading) return <div className="text-text-tertiary">로딩 중...</div>;
  if (!survey) return null;

  const isDraft = survey.status === "draft";
  const isActive = survey.status === "active";
  const isClosed = survey.status === "closed";
  const canEdit = survey.is_author && isDraft;

  return (
    // Google Forms 식 — 옅은 라벤더 페이지 배경, 보라 액센트
    <div className="min-h-[calc(100vh-150px)] -mx-4 -my-4 px-4 py-6 bg-[#f0ebf8]">
      <div className="max-w-3xl mx-auto">
        {/* 상단 액션 row */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <Link
            href="/drive"
            className="text-caption text-text-tertiary hover:text-accent inline-flex items-center gap-1 mr-2"
          >
            <ArrowLeft size={12} /> 내 드라이브
          </Link>
          <span className={`text-caption px-2 py-0.5 rounded ${
            isDraft ? "bg-white text-text-secondary border border-border-default"
              : isActive ? "bg-green-100 text-green-700"
              : "bg-amber-100 text-amber-700"
          }`}>
            {isDraft ? "초안" : isActive ? "응답 받는 중" : "마감"}
          </span>
          {survey.is_anonymous && (
            <span className="text-caption px-2 py-0.5 rounded bg-white border border-border-default inline-flex items-center gap-1">
              <Lock size={11} /> 익명
            </span>
          )}
          <div className="flex-1" />
          {survey.is_author && (
            <div className="flex items-center gap-1.5">
              {isDraft && (
                <button
                  onClick={() => updateMeta({ status: "active" })}
                  className="flex items-center gap-1 px-3.5 py-1.5 text-caption bg-[#673ab7] text-white rounded-md hover:bg-[#5e35b1] font-medium"
                  title="응답 받기 시작 (Google 식 '게시')"
                >
                  게시
                </button>
              )}
              {isActive && (
                <button
                  onClick={() => updateMeta({ status: "closed" })}
                  className="flex items-center gap-1 px-3 py-1.5 text-caption bg-amber-600 text-white rounded-md hover:bg-amber-700"
                >
                  <Archive size={12} /> 마감
                </button>
              )}
              {isClosed && (
                <button
                  onClick={() => updateMeta({ status: "draft" })}
                  className="flex items-center gap-1 px-3 py-1.5 text-caption bg-white border border-border-default rounded-md hover:bg-bg-secondary"
                  title="초안으로 (질문 편집 가능)"
                >
                  <Pencil size={12} /> 초안으로
                </button>
              )}
              {isActive && (
                <button
                  onClick={() => setShowShare(true)}
                  className="flex items-center gap-1 px-3 py-1.5 text-caption bg-white border border-[#673ab7] text-[#673ab7] rounded-md hover:bg-[#ede7f6]"
                  title="단축 링크 + QR 공유"
                >
                  <Share2 size={12} /> 보내기
                </button>
              )}
              {(isActive || isClosed) && (
                <Link
                  href={`/classroom/${cid}/surveys/${sid}/results`}
                  className="flex items-center gap-1 px-3 py-1.5 text-caption bg-white border border-border-default text-text-primary rounded-md hover:bg-bg-secondary"
                >
                  <BarChart3 size={12} /> 응답
                </Link>
              )}
              <button
                onClick={deleteSurvey}
                className="p-1.5 text-text-tertiary hover:text-status-error hover:bg-white rounded"
                title="설문 삭제"
              >
                <Trash2 size={14} />
              </button>
            </div>
          )}
        </div>

        {/* 제목 카드 — Google Forms 식 (보라 상단 바 + 큰 제목) */}
        <div className="bg-white rounded-lg shadow-sm overflow-hidden mb-3" style={{ borderTop: "10px solid #673ab7" }}>
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
                  updateMeta({ description: e.target.value });
                }
              }}
              className="w-full text-[13px] text-text-secondary bg-transparent border-0 outline-none focus:border-b focus:border-[#673ab7] mt-3 pb-1"
            />
          </div>
        </div>

        {/* 응답 수정 허용 시간 — 작성자만 */}
        {survey.is_author && (
          <div className="bg-white rounded-lg shadow-sm px-4 py-2.5 mb-3 flex items-center gap-2 text-caption text-text-secondary">
            <Clock size={12} className="text-text-tertiary" />
            <span>응답 후 수정 허용:</span>
            <input
              type="number"
              min={0}
              max={10080}
              defaultValue={survey.response_edit_minutes}
              onBlur={(e) => {
                const v = Math.max(0, Math.min(10080, Number(e.target.value) || 0));
                if (v !== survey.response_edit_minutes) {
                  updateMeta({ response_edit_minutes: v });
                }
              }}
              className="w-16 px-2 py-0.5 border border-border-default rounded bg-white text-center"
            />
            <span className="text-text-tertiary">분 (0 = 수정 불가)</span>
          </div>
        )}

        {/* 질문 카드들 — 드래그로 순서 변경 (draft + canEdit 시만) */}
        <div className="space-y-3 mb-3">
          {survey.questions.length === 0 ? (
            <div className="bg-white rounded-lg shadow-sm py-16 text-center text-caption text-text-tertiary">
              아직 질문이 없습니다. {canEdit && "[질문 추가] 버튼으로 시작하세요."}
            </div>
          ) : canEdit ? (
            <SortableQuestions
              questions={survey.questions}
              onReorder={async (ids) => {
                // 낙관적 업데이트 + API 호출
                const map = new Map(survey.questions.map((q) => [q.id, q]));
                const reordered = ids.map((id, i) => ({ ...map.get(id)!, order: i }));
                setSurvey({ ...survey, questions: reordered });
                try {
                  await api.post(`/api/classroom/surveys/${sid}/questions/_reorder`, { question_ids: ids });
                } catch (e: any) {
                  alert(e?.detail || "순서 저장 실패");
                  load();
                }
              }}
              onDelete={deleteQuestion}
            />
          ) : (
            survey.questions.map((q, idx) => (
              <QuestionCard
                key={q.id}
                q={q}
                index={idx}
                canEdit={false}
                onDelete={() => deleteQuestion(q.id)}
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
            onSaved={() => { setShowAddQ(false); load(); }}
          />
        )}

        {showShare && (
          <ShareLinkModal
            targetType="survey"
            targetId={sid}
            targetTitle={survey.title}
            onClose={() => setShowShare(false)}
          />
        )}
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────
// 드래그 가능한 질문 list (draft 상태에서만 사용)
// ─────────────────────────────────────────────────────────────
function SortableQuestions({
  questions,
  onReorder,
  onDelete,
}: {
  questions: Question[];
  onReorder: (ids: number[]) => void;
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

function SortableQuestionRow({ q, index, onDelete }: { q: Question; index: number; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: q.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="relative group">
      {/* 좌측 드래그 핸들 */}
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

