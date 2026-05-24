"use client";

/**
 * 학생 풀이 view — 문제 한 화면 list + 제출.
 *
 *  - type별 답안 input
 *  - 제출 → /submit → 자동 채점 결과 즉시 표시
 *  - 마감/한도 초과 시 입력 비활성
 *  - show_solution_after_due + is_past_due 면 정답·해설 표시
 */

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, XCircle, Clock, RotateCw, Send, FileQuestion } from "lucide-react";
import { api } from "@/lib/api/client";
import { useToast } from "@/components/ui/Toast";
import { ProblemContent } from "./ProblemContent";
import type { StudentViewResp, SubmitResult, ProblemForStudent } from "./types";

interface Props {
  psid: number;
}

type AnswerMap = Record<number, Record<string, any>>;

export function StudentSolveView({ psid }: Props) {
  const toast = useToast();
  const [data, setData] = useState<StudentViewResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<SubmitResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<StudentViewResp>(
        `/api/courseware/problem-sets/${psid}/student-view`,
      );
      setData(res);
      // 답안 초기화 — type별
      const init: AnswerMap = {};
      for (const p of res.problems) {
        if (p.type === "multiple_choice") init[p.id] = { selected: [] };
        else if (p.type === "numeric") init[p.id] = { value: "" };
        else init[p.id] = { text: "" };
      }
      setAnswers(init);
    } catch (e: any) {
      toast.show(e?.detail || "조회 실패", "error");
    } finally {
      setLoading(false);
    }
  }, [psid, toast]);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async () => {
    if (!data) return;
    const unanswered = data.problems.filter((p) => {
      const a = answers[p.id] || {};
      if (p.type === "multiple_choice") return !(a.selected?.length);
      if (p.type === "numeric") return a.value === "" || a.value === undefined || a.value === null;
      return !(a.text || "").trim();
    });
    if (unanswered.length > 0) {
      if (!confirm(`${unanswered.length}문제가 비어있습니다. 그래도 제출할까요?`)) return;
    }
    setSubmitting(true);
    try {
      const body = {
        answers: data.problems.map((p) => ({
          problem_id: p.id,
          answer: answers[p.id] || {},
        })),
      };
      const res = await api.post<SubmitResult>(
        `/api/courseware/problem-sets/${psid}/submit`,
        body,
      );
      setLastResult(res);
      toast.show(
        `제출 완료 — 자동채점 ${res.auto_correct}/${res.auto_graded}` +
          (res.manual_pending ? ` · 수동 ${res.manual_pending}건 대기` : ""),
        "success",
      );
      load();
    } catch (e: any) {
      toast.show(e?.detail || "제출 실패", "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="text-text-tertiary">로딩 중...</div>;
  if (!data) return null;

  const cantSubmit = data.is_past_due || data.attempts_left <= 0;
  const dueText = data.due_date
    ? new Date(data.due_date).toLocaleString("ko-KR")
    : "기한 없음";

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* 헤더 */}
      <div className="bg-bg-primary border border-border-default rounded-lg p-4">
        <h1 className="text-h2 mb-1">{data.title}</h1>
        {data.description && (
          <p className="text-body text-text-secondary mb-2">{data.description}</p>
        )}
        <div className="flex flex-wrap gap-3 text-caption text-text-tertiary">
          <span className="flex items-center gap-1">
            <FileQuestion size={12} /> {data.problem_count}문제
          </span>
          <span className="flex items-center gap-1">
            <Clock size={12} /> 마감 {dueText}
          </span>
          <span className="flex items-center gap-1">
            <RotateCw size={12} /> 시도 {data.attempts_used}/{data.max_attempts}
          </span>
        </div>
        {cantSubmit && (
          <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded text-caption text-amber-900">
            {data.is_past_due
              ? "마감 시간이 지났습니다. 더 이상 제출할 수 없습니다."
              : "재응시 한도를 초과했습니다."}
          </div>
        )}
      </div>

      {/* 마지막 채점 결과 요약 */}
      {lastResult && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
          <div className="text-body font-semibold text-emerald-900 mb-1">
            제출 #{lastResult.attempt_number} 결과
          </div>
          <div className="text-caption text-emerald-800">
            자동 채점: {lastResult.auto_correct}/{lastResult.auto_graded} 정답
            {lastResult.manual_pending > 0 && (
              <> · 수동 채점 대기 {lastResult.manual_pending}건</>
            )}
          </div>
        </div>
      )}

      {/* 문제 list */}
      {data.problems.map((p, i) => (
        <ProblemCard
          key={p.id}
          index={i}
          problem={p}
          answer={answers[p.id] || {}}
          onChange={(next) => setAnswers((prev) => ({ ...prev, [p.id]: next }))}
          revealed={data.solution_revealed}
          lastResult={lastResult?.results.find((r) => r.problem_id === p.id)}
          disabled={cantSubmit}
        />
      ))}

      {/* 제출 */}
      {!cantSubmit && (
        <div className="sticky bottom-4 flex justify-end">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="px-6 py-2.5 bg-accent-default text-white rounded-lg shadow-md hover:opacity-90 disabled:opacity-50 flex items-center gap-2 text-body"
          >
            <Send size={16} />
            {submitting ? "제출 중..." : "답안 제출"}
          </button>
        </div>
      )}
    </div>
  );
}


interface ProblemCardProps {
  index: number;
  problem: ProblemForStudent;
  answer: Record<string, any>;
  onChange: (next: Record<string, any>) => void;
  revealed: boolean;
  lastResult?: {
    is_correct: boolean | null;
    auto_score: number;
    has_manual_pending: boolean;
  };
  disabled?: boolean;
}

function ProblemCard({
  index, problem, answer, onChange, revealed, lastResult, disabled,
}: ProblemCardProps) {
  return (
    <div className="bg-bg-primary border border-border-default rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-caption text-text-tertiary font-semibold">
          문제 {index + 1} <span className="font-normal">· {problem.type}</span>
        </div>
        {lastResult && (
          <div className="flex items-center gap-1 text-caption">
            {lastResult.is_correct === true && (
              <>
                <CheckCircle2 size={14} className="text-emerald-600" />
                <span className="text-emerald-700 font-semibold">정답</span>
              </>
            )}
            {lastResult.is_correct === false && (
              <>
                <XCircle size={14} className="text-red-600" />
                <span className="text-red-700 font-semibold">오답</span>
              </>
            )}
            {lastResult.is_correct === null && lastResult.has_manual_pending && (
              <span className="text-amber-700 font-semibold">수동 채점 대기</span>
            )}
          </div>
        )}
      </div>
      <ProblemContent content={problem.content} className="text-body mb-3 whitespace-pre-wrap" />

      {/* type별 input */}
      {problem.type === "multiple_choice" && (
        <div className="space-y-1.5">
          {(problem.choices || []).map((c, i) => {
            const letter = String.fromCharCode(65 + i);
            const selected = (answer.selected || []).includes(letter);
            return (
              <label
                key={i}
                className={`flex items-center gap-2 p-2 border rounded cursor-pointer ${
                  selected ? "border-accent-default bg-cream-50" : "border-border-default hover:bg-bg-secondary"
                } ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={disabled}
                  onChange={(e) => {
                    const cur = new Set(answer.selected || []);
                    if (e.target.checked) cur.add(letter);
                    else cur.delete(letter);
                    onChange({ ...answer, selected: Array.from(cur) });
                  }}
                />
                <span className="font-mono text-caption text-text-tertiary w-5">{letter}</span>
                <span className="text-body">{c}</span>
              </label>
            );
          })}
        </div>
      )}

      {problem.type === "short_answer" && (
        <input
          value={answer.text || ""}
          onChange={(e) => onChange({ text: e.target.value })}
          disabled={disabled}
          placeholder="답을 입력하세요"
          className="w-full px-3 py-2 border border-border-default rounded text-body"
        />
      )}

      {problem.type === "numeric" && (
        <input
          type="number"
          step="any"
          value={answer.value ?? ""}
          onChange={(e) => onChange({ value: e.target.value === "" ? "" : parseFloat(e.target.value) })}
          disabled={disabled}
          placeholder="숫자 입력"
          className="w-full px-3 py-2 border border-border-default rounded text-body"
        />
      )}

      {(problem.type === "essay" || problem.type === "code") && (
        <textarea
          value={answer.text || ""}
          onChange={(e) => onChange({ text: e.target.value })}
          disabled={disabled}
          rows={6}
          placeholder="답안 작성"
          className="w-full px-3 py-2 border border-border-default rounded text-body font-mono"
        />
      )}

      {/* 정답·해설 (revealed일 때만) */}
      {revealed && (
        <div className="mt-3 pt-3 border-t border-border-default space-y-2">
          {problem.answer && (
            <div className="text-caption">
              <span className="text-text-tertiary font-semibold">정답:</span>{" "}
              <span className="text-text-primary">{problem.answer}</span>
            </div>
          )}
          {problem.solution && (
            <div className="text-caption">
              <div className="text-text-tertiary font-semibold mb-1">해설</div>
              <div className="text-text-secondary whitespace-pre-wrap">{problem.solution}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
