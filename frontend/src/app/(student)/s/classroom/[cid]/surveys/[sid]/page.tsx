"use client";

/**
 * 학생용 설문 응답 폼.
 *
 * - status=active + access_mode 통과 + 본인이 아직 응답 안 함(allow_multiple=false)
 * - 질문 type별 입력 컨트롤
 * - 필수 질문 검증 (frontend) — 통과해도 backend가 다시 검증
 * - 제출 후 완료 화면
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Send, CheckCircle, Lock, Pencil, Clock } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAutoCollapseSidebar } from "@/lib/hooks/use-auto-collapse-sidebar";

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
  title: string;
  description: string | null;
  status: string;
  is_anonymous: boolean;
  allow_multiple_responses: boolean;
  response_edit_minutes: number;
  open_at: string | null;
  close_at: string | null;
  questions: Question[];
  is_author: boolean;
  can_respond: boolean;
  my_response: {
    id: number;
    submitted_at: string | null;
    editable_until: string | null;
  } | null;
}


function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

interface AnswerDraft {
  question_id: number;
  text_value?: string;
  choice_values?: string[];
  rating_value?: number;
}

export default function StudentSurveyResponsePage() {
  useAutoCollapseSidebar();
  const params = useParams();
  const router = useRouter();
  const cid = Number(params.cid);
  const sid = Number(params.sid);

  const [survey, setSurvey] = useState<SurveyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState<Record<number, AnswerDraft>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  // 응답 수정 모드 — PUT으로 보냄
  const [editMode, setEditMode] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await api.get<SurveyDetail>(`/api/classroom/surveys/${sid}`);
      setSurvey(s);
      // 응답 draft 초기화
      const init: Record<number, AnswerDraft> = {};
      s.questions.forEach((q) => {
        init[q.id] = { question_id: q.id };
        if (q.question_type === "multi_choice") init[q.id].choice_values = [];
      });
      setAnswers(init);
    } catch (e: any) {
      alert(e?.detail || "설문 조회 실패");
      router.push(`/s/classroom/${cid}/surveys`);
    } finally {
      setLoading(false);
    }
  }, [cid, sid, router]);

  useEffect(() => { load(); }, [load]);

  const setAnswer = (qid: number, patch: Partial<AnswerDraft>) => {
    setAnswers((prev) => ({ ...prev, [qid]: { ...prev[qid], ...patch } }));
  };

  const submit = async () => {
    if (!survey) return;
    // 필수 질문 검증
    for (const q of survey.questions) {
      if (!q.is_required) continue;
      const a = answers[q.id];
      const filled =
        (a.text_value && a.text_value.trim()) ||
        (a.choice_values && a.choice_values.length > 0) ||
        (a.rating_value !== undefined && a.rating_value !== null);
      if (!filled) {
        alert(`필수 질문 미응답: "${q.question_text}"`);
        return;
      }
    }
    setSubmitting(true);
    try {
      const payload = {
        answers: survey.questions.map((q) => answers[q.id]).filter(
          (a) =>
            (a.text_value && a.text_value.trim()) ||
            (a.choice_values && a.choice_values.length > 0) ||
            (a.rating_value !== undefined && a.rating_value !== null),
        ),
      };
      if (editMode && survey.my_response) {
        await api.put(
          `/api/classroom/surveys/responses/${survey.my_response.id}`,
          payload,
        );
      } else {
        await api.post(`/api/classroom/surveys/${sid}/responses`, payload);
      }
      setSubmitted(true);
    } catch (e: any) {
      alert(e?.detail || "제출 실패");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="text-text-tertiary">로딩 중...</div>;
  if (!survey) return null;

  // 이미 제출 완료 후
  if (submitted) {
    return (
      <div className="max-w-2xl mx-auto text-center py-20">
        <CheckCircle size={48} className="text-status-success mx-auto mb-4" />
        <h1 className="text-title font-semibold mb-2">응답이 제출되었습니다</h1>
        <p className="text-body text-text-secondary mb-6">
          소중한 의견 감사합니다.
        </p>
        <Link
          href="/s/drive"
          className="inline-flex items-center gap-1 px-4 py-2 text-caption bg-accent text-white rounded hover:bg-accent-hover"
        >
          내 드라이브로
        </Link>
      </div>
    );
  }

  // 응답 불가 (이미 답했거나 마감) — 단, my_response.editable_until > now면 수정 가능
  const canEditExisting = !!(
    survey.my_response?.editable_until &&
    Date.parse(survey.my_response.editable_until) > Date.now()
  );

  if (!survey.can_respond && !editMode) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="mb-3">
          <Link
            href="/s/drive"
            className="text-caption text-text-tertiary hover:text-accent inline-flex items-center gap-1"
          >
            <ArrowLeft size={12} /> 내 드라이브
          </Link>
        </div>
        <h1 className="text-title mb-2">{survey.title}</h1>
        <div className="border border-cream-300 bg-cream-100 rounded-lg p-6 text-center mt-4">
          <Lock size={32} className="mx-auto text-text-tertiary mb-2" />
          {survey.my_response ? (
            <>
              <div className="text-body font-medium mb-1">이미 응답하셨습니다</div>
              <div className="text-caption text-text-tertiary mb-3">
                제출 시각: {survey.my_response.submitted_at?.slice(0, 16).replace("T", " ")}
              </div>
              {canEditExisting && (
                <>
                  <div className="text-caption text-text-secondary mb-3 inline-flex items-center gap-1 bg-bg-primary px-2 py-1 rounded border border-border-default">
                    <Clock size={11} />
                    수정 가능 시한: {survey.my_response.editable_until!.slice(0, 16).replace("T", " ")}
                  </div>
                  <div>
                    <button
                      onClick={() => setEditMode(true)}
                      className="inline-flex items-center gap-1 px-4 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover"
                    >
                      <Pencil size={12} /> 응답 수정
                    </button>
                  </div>
                </>
              )}
            </>
          ) : (() => {
            // 분기: open_at 미도래 / close_at 경과 / status 비활성 / 권한 없음
            const now = Date.now();
            const openTs = survey.open_at ? Date.parse(survey.open_at) : null;
            const closeTs = survey.close_at ? Date.parse(survey.close_at) : null;
            if (openTs && openTs > now) {
              return (
                <>
                  <div className="text-body font-medium mb-1">아직 응답 시작 전입니다</div>
                  <div className="text-caption text-text-secondary">
                    시작: {fmtDate(survey.open_at!)}
                  </div>
                </>
              );
            }
            if (closeTs && closeTs < now) {
              return (
                <>
                  <div className="text-body font-medium mb-1">응답이 마감되었습니다</div>
                  <div className="text-caption text-text-secondary">
                    마감: {fmtDate(survey.close_at!)}
                  </div>
                </>
              );
            }
            if (survey.status !== "active") {
              return <div className="text-body font-medium">설문이 게시되지 않았습니다</div>;
            }
            return <div className="text-body font-medium">응답 권한이 없습니다</div>;
          })()}
        </div>
      </div>
    );
  }

  // 정상 응답 폼
  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-3">
        <Link
          href="/s/drive"
          className="text-caption text-text-tertiary hover:text-accent inline-flex items-center gap-1"
        >
          <ArrowLeft size={12} /> 내 드라이브
        </Link>
      </div>
      <h1 className="text-title font-semibold mb-2 flex items-center gap-2">
        {survey.title}
        {editMode && (
          <span className="text-caption px-2 py-0.5 bg-amber-100 text-amber-700 rounded inline-flex items-center gap-1 font-normal">
            <Pencil size={11} /> 수정 중
          </span>
        )}
      </h1>
      {survey.description && (
        <p className="text-body text-text-secondary mb-3">{survey.description}</p>
      )}
      {survey.is_anonymous && (
        <div className="text-caption text-text-secondary mb-4 inline-flex items-center gap-1 bg-cream-100 border border-cream-300 px-2 py-1 rounded">
          <Lock size={11} /> 익명 응답 — 응답자 정보가 기록되지 않습니다
        </div>
      )}
      {survey.close_at && (
        <div className="text-caption text-text-secondary mb-4 ml-2 inline-flex items-center gap-1 bg-amber-50 border border-amber-200 px-2 py-1 rounded">
          <Clock size={11} /> 마감: {fmtDate(survey.close_at)}
        </div>
      )}
      {editMode && (
        <div className="text-caption text-text-secondary mb-4 inline-flex items-center gap-1 bg-amber-50 border border-amber-200 px-2 py-1 rounded">
          <Clock size={11} /> 기존 응답을 새 답으로 대체합니다. 비워두면 답이 사라집니다.
        </div>
      )}

      <div className="space-y-4 mt-4">
        {survey.questions.map((q, idx) => (
          <QuestionInput
            key={q.id}
            q={q}
            index={idx}
            answer={answers[q.id]}
            onChange={(patch) => setAnswer(q.id, patch)}
          />
        ))}
      </div>

      <div className="mt-6 flex justify-end">
        <button
          onClick={submit}
          disabled={submitting}
          className="flex items-center gap-1 px-6 py-2 text-body bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
        >
          <Send size={14} /> {submitting ? "제출 중..." : "제출"}
        </button>
      </div>
    </div>
  );
}


function QuestionInput({
  q, index, answer, onChange,
}: {
  q: Question;
  index: number;
  answer: AnswerDraft;
  onChange: (patch: Partial<AnswerDraft>) => void;
}) {
  return (
    <div className="border border-border-default rounded-lg p-4 bg-bg-primary">
      <div className="flex items-start gap-2 mb-3">
        <span className="text-caption text-text-tertiary font-medium">Q{index + 1}.</span>
        <div className="flex-1 text-body text-text-primary whitespace-pre-wrap">
          {q.question_text}
          {q.is_required && <span className="text-status-error ml-1">*</span>}
        </div>
      </div>

      {q.question_type === "short_text" && (
        <input
          type="text"
          value={answer.text_value || ""}
          onChange={(e) => onChange({ text_value: e.target.value })}
          className="w-full px-2 py-1.5 text-body border border-border-default rounded bg-bg-primary"
        />
      )}

      {q.question_type === "long_text" && (
        <textarea
          value={answer.text_value || ""}
          onChange={(e) => onChange({ text_value: e.target.value })}
          rows={4}
          className="w-full px-2 py-1.5 text-body border border-border-default rounded bg-bg-primary resize-y"
        />
      )}

      {q.question_type === "date" && (
        <input
          type="date"
          value={answer.text_value || ""}
          onChange={(e) => onChange({ text_value: e.target.value })}
          className="px-2 py-1.5 text-body border border-border-default rounded bg-bg-primary"
        />
      )}

      {q.question_type === "rating" && (
        <div className="flex gap-1">
          {Array.from({ length: q.rating_max }, (_, i) => i + 1).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onChange({ rating_value: v })}
              className={`w-9 h-9 border rounded text-body font-medium transition ${
                answer.rating_value === v
                  ? "bg-accent text-white border-accent"
                  : "border-border-default hover:border-accent hover:bg-bg-secondary"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      )}

      {q.question_type === "single_choice" && (
        <div className="space-y-2">
          {q.options.map((opt, i) => (
            <label key={i} className="flex items-center gap-2 cursor-pointer text-body p-1 hover:bg-bg-secondary rounded">
              <input
                type="radio"
                name={`q-${q.id}`}
                checked={(answer.choice_values || [])[0] === opt}
                onChange={() => onChange({ choice_values: [opt] })}
              />
              <span>{opt}</span>
            </label>
          ))}
        </div>
      )}

      {q.question_type === "multi_choice" && (
        <div className="space-y-2">
          {q.options.map((opt, i) => {
            const checked = (answer.choice_values || []).includes(opt);
            return (
              <label key={i} className="flex items-center gap-2 cursor-pointer text-body p-1 hover:bg-bg-secondary rounded">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const cur = answer.choice_values || [];
                    if (e.target.checked) {
                      onChange({ choice_values: [...cur, opt] });
                    } else {
                      onChange({ choice_values: cur.filter((v) => v !== opt) });
                    }
                  }}
                />
                <span>{opt}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
