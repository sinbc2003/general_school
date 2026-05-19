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
  Share2, Lock as LockIcon, Clock,
} from "lucide-react";
import { api } from "@/lib/api/client";
import ShareLinkModal from "@/components/classroom/ShareLinkModal";
import { QuestionCard } from "./_components/QuestionCard";
import { AddQuestionModal } from "./_components/AddQuestionModal";
import type { Question } from "./_components/_types";


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
    <div className="max-w-3xl mx-auto">
      <div className="mb-3">
        <Link
          href={`/classroom/${cid}/surveys`}
          className="text-caption text-text-tertiary hover:text-accent inline-flex items-center gap-1"
        >
          <ArrowLeft size={12} /> 설문 목록
        </Link>
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className={`text-caption px-2 py-0.5 rounded ${
          isDraft ? "bg-cream-200 text-text-secondary"
            : isActive ? "bg-green-100 text-green-700"
            : "bg-amber-100 text-amber-700"
        }`}>
          {isDraft ? "초안" : isActive ? "응답 받는 중" : "마감"}
        </span>
        {survey.is_anonymous && (
          <span className="text-caption px-2 py-0.5 rounded bg-cream-200 inline-flex items-center gap-1">
            <Lock size={11} /> 익명
          </span>
        )}
        <div className="flex-1" />
        {survey.is_author && (
          <div className="flex items-center gap-1">
            {isDraft && (
              <button
                onClick={() => updateMeta({ status: "active" })}
                className="flex items-center gap-1 px-2 py-1 text-caption bg-green-600 text-white rounded hover:bg-green-700"
                title="응답 받기 시작"
              >
                <Unlock size={12} /> 활성화
              </button>
            )}
            {isActive && (
              <button
                onClick={() => updateMeta({ status: "closed" })}
                className="flex items-center gap-1 px-2 py-1 text-caption bg-amber-600 text-white rounded hover:bg-amber-700"
                title="응답 마감"
              >
                <Archive size={12} /> 마감
              </button>
            )}
            {isClosed && (
              <button
                onClick={() => updateMeta({ status: "draft" })}
                className="flex items-center gap-1 px-2 py-1 text-caption border border-border-default rounded hover:bg-bg-secondary"
                title="초안으로 되돌리기 (질문 편집 가능)"
              >
                <Pencil size={12} /> 초안으로
              </button>
            )}
            {isActive && (
              <button
                onClick={() => setShowShare(true)}
                className="flex items-center gap-1 px-2 py-1 text-caption border border-accent text-accent rounded hover:bg-accent-light"
                title="단축 링크 + QR 공유"
              >
                <Share2 size={12} /> 공유
              </button>
            )}
            {(isActive || isClosed) && (
              <Link
                href={`/classroom/${cid}/surveys/${sid}/results`}
                className="flex items-center gap-1 px-2 py-1 text-caption bg-accent text-white rounded hover:bg-accent-hover"
              >
                <BarChart3 size={12} /> 결과 보기
              </Link>
            )}
            <button
              onClick={deleteSurvey}
              className="p-1 text-text-tertiary hover:text-status-error rounded"
              title="설문 삭제"
            >
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>

      <input
        type="text"
        value={titleDraft}
        onChange={(e) => setTitleDraft(e.target.value)}
        onBlur={saveTitle}
        disabled={!canEdit}
        className="w-full text-title font-semibold bg-transparent border-0 outline-none focus:bg-bg-secondary px-2 py-1 rounded disabled:text-text-tertiary mb-2"
      />

      {survey.description && (
        <p className="text-body text-text-secondary mb-4 px-2">{survey.description}</p>
      )}

      {/* 응답 수정 허용 시간 — 작성자만, 모든 상태에서 동적 변경 가능 */}
      {survey.is_author && (
        <div className="flex items-center gap-2 text-caption text-text-secondary mb-4 px-2">
          <Clock size={11} />
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
            className="w-20 px-2 py-1 border border-border-default rounded bg-bg-primary"
          />
          <span className="text-text-tertiary">분 (0 = 수정 불가)</span>
        </div>
      )}

      <div className="space-y-3 mb-4">
        {survey.questions.length === 0 ? (
          <div className="text-caption text-text-tertiary py-12 text-center border border-dashed border-border-default rounded">
            아직 질문이 없습니다. {canEdit && "아래 [질문 추가] 버튼을 누르세요."}
          </div>
        ) : (
          survey.questions.map((q, idx) => (
            <QuestionCard
              key={q.id}
              q={q}
              index={idx}
              canEdit={canEdit}
              onDelete={() => deleteQuestion(q.id)}
            />
          ))
        )}
      </div>

      {canEdit && (
        <button
          onClick={() => setShowAddQ(true)}
          className="w-full py-3 border-2 border-dashed border-border-default rounded text-caption text-text-secondary hover:border-accent hover:text-accent"
        >
          <Plus size={14} className="inline mr-1" /> 질문 추가
        </button>
      )}

      {!canEdit && !isDraft && (
        <div className="mt-4 text-caption text-text-tertiary p-3 bg-cream-100 border border-cream-300 rounded inline-flex items-center gap-1">
          <LockIcon size={12} /> 활성/마감 상태에서는 질문을 편집할 수 없습니다. 변경하려면 "초안으로" 되돌리세요.
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
  );
}
