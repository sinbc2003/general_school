"use client";

/**
 * 설문 빌더 + 상태 토글 + 결과 페이지로 이동.
 *
 * - status=draft: 질문 추가/편집/삭제 + 메타 편집 + Active 토글
 * - status=active: 질문 변경 잠금. 결과 페이지로 이동 가능. Close 토글.
 * - status=closed: 결과 조회 + Draft로 되돌리기
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, ClipboardList, Plus, Trash2, BarChart3, Lock, Unlock, Archive,
  Pencil, Save, X, GripVertical, Lock as LockIcon,
} from "lucide-react";
import { api } from "@/lib/api/client";

type QType = "short_text" | "long_text" | "single_choice" | "multi_choice" | "rating" | "date";

interface Question {
  id: number;
  order: number;
  question_text: string;
  question_type: QType;
  is_required: boolean;
  options: string[];
  rating_max: number;
}

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
  questions: Question[];
  is_author: boolean;
}

const TYPE_LABELS: Record<QType, string> = {
  short_text: "단답형",
  long_text: "장문형",
  single_choice: "객관식 (한 개)",
  multi_choice: "체크박스 (여러 개)",
  rating: "평점",
  date: "날짜",
};

export default function SurveyBuilderPage() {
  const params = useParams();
  const router = useRouter();
  const cid = Number(params.cid);
  const sid = Number(params.sid);

  const [survey, setSurvey] = useState<SurveyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddQ, setShowAddQ] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

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

      {/* 상태 + 액션 */}
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

      {/* 제목 */}
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

      {/* 질문 목록 */}
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
              onReload={load}
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
    </div>
  );
}


function QuestionCard({
  q, index, canEdit, onDelete, onReload,
}: {
  q: Question;
  index: number;
  canEdit: boolean;
  onDelete: () => void;
  onReload: () => void;
}) {
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
      {/* 미리보기 (응답 UI 모방) */}
      <QuestionPreview q={q} />
    </div>
  );
}


function QuestionPreview({ q }: { q: Question }) {
  const cls = "text-caption text-text-tertiary border border-border-default rounded px-2 py-1 bg-bg-secondary";

  if (q.question_type === "short_text") {
    return <div className={cls}>단답 입력란</div>;
  }
  if (q.question_type === "long_text") {
    return <div className={cls + " min-h-[60px]"}>장문 입력란</div>;
  }
  if (q.question_type === "date") {
    return <div className={cls + " w-32"}>날짜 선택</div>;
  }
  if (q.question_type === "rating") {
    return (
      <div className="flex gap-1">
        {Array.from({ length: q.rating_max }, (_, i) => (
          <span key={i} className="w-7 h-7 border border-border-default rounded text-caption flex items-center justify-center bg-bg-secondary text-text-tertiary">
            {i + 1}
          </span>
        ))}
      </div>
    );
  }
  if (q.question_type === "single_choice" || q.question_type === "multi_choice") {
    return (
      <div className="space-y-1">
        {q.options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2 text-caption">
            <span className={`w-3 h-3 border border-border-default ${
              q.question_type === "single_choice" ? "rounded-full" : "rounded-sm"
            }`} />
            <span>{opt}</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
}


function AddQuestionModal({
  sid, onClose, onSaved,
}: { sid: number; onClose: () => void; onSaved: () => void }) {
  const [questionText, setQuestionText] = useState("");
  const [type, setType] = useState<QType>("short_text");
  const [isRequired, setIsRequired] = useState(false);
  const [optionsText, setOptionsText] = useState("");  // 줄바꿈 구분
  const [ratingMax, setRatingMax] = useState(5);
  const [saving, setSaving] = useState(false);

  const needsOptions = type === "single_choice" || type === "multi_choice";
  const needsRating = type === "rating";

  const save = async () => {
    if (!questionText.trim()) return alert("질문 내용을 입력하세요");
    const opts = optionsText.split("\n").map((s) => s.trim()).filter(Boolean);
    if (needsOptions && opts.length < 2) {
      return alert("객관식·체크박스는 옵션 2개 이상 필요");
    }
    setSaving(true);
    try {
      await api.post(`/api/classroom/surveys/${sid}/questions`, {
        question_text: questionText.trim(),
        question_type: type,
        is_required: isRequired,
        options: needsOptions ? opts : null,
        rating_max: needsRating ? ratingMax : 5,
      });
      onSaved();
    } catch (e: any) {
      alert(e?.detail || "추가 실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-bg-primary rounded-lg shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b border-border-default">
          <h2 className="text-body font-semibold">질문 추가</h2>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="text-caption text-text-secondary block mb-1">유형</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as QType)}
              className="w-full px-2 py-1.5 text-body border border-border-default rounded bg-bg-primary"
            >
              {(Object.keys(TYPE_LABELS) as QType[]).map((t) => (
                <option key={t} value={t}>{TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-caption text-text-secondary block mb-1">질문 *</label>
            <textarea
              value={questionText}
              onChange={(e) => setQuestionText(e.target.value)}
              rows={2}
              placeholder="예: 오늘 수업이 얼마나 이해되었나요?"
              className="w-full px-2 py-1.5 text-body border border-border-default rounded bg-bg-primary resize-y"
            />
          </div>
          {needsOptions && (
            <div>
              <label className="text-caption text-text-secondary block mb-1">
                옵션 (줄바꿈 구분, 2개 이상)
              </label>
              <textarea
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                rows={4}
                placeholder="옵션 1&#10;옵션 2&#10;옵션 3"
                className="w-full px-2 py-1.5 text-body border border-border-default rounded bg-bg-primary resize-y font-mono text-caption"
              />
            </div>
          )}
          {needsRating && (
            <div>
              <label className="text-caption text-text-secondary block mb-1">
                평점 최댓값 (1 ~ {ratingMax})
              </label>
              <input
                type="number"
                min={2}
                max={10}
                value={ratingMax}
                onChange={(e) => setRatingMax(Math.max(2, Math.min(10, Number(e.target.value))))}
                className="w-20 px-2 py-1.5 text-body border border-border-default rounded bg-bg-primary"
              />
            </div>
          )}
          <label className="flex items-center gap-2 text-caption cursor-pointer">
            <input type="checkbox" checked={isRequired} onChange={(e) => setIsRequired(e.target.checked)} />
            필수 답변
          </label>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-border-default">
          <button onClick={onClose} className="px-4 py-1.5 text-caption border border-border-default rounded">취소</button>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1 px-4 py-1.5 text-caption bg-accent text-white rounded disabled:opacity-50"
          >
            <Save size={12} /> {saving ? "추가 중..." : "추가"}
          </button>
        </div>
      </div>
    </div>
  );
}
