"use client";

/**
 * 학생 풀이 view — 문제 한 화면 list + 제출.
 *
 *  - type별 답안 input
 *  - 제출 → /submit → 자동 채점 결과 즉시 표시
 *  - 마감/한도 초과 시 입력 비활성
 *  - show_solution_after_due + is_past_due 면 정답·해설 표시
 *  - settings.shuffle_questions: 문제 순서 random (학생당 1회 sessionStorage 캐시)
 *  - time_limit_seconds: sticky bar에 남은 시간, 0 도달 시 자동 제출
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2, XCircle, Clock, RotateCw, Send, FileQuestion, Timer,
  Bot, Loader2,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { useToast } from "@/components/ui/Toast";
import { ProblemContent, InlineMathText } from "./ProblemContent";
import type {
  StudentViewResp, SubmitResult, ProblemForStudent, MyAttemptRow, GradingStatus,
} from "./types";

interface Props {
  psid: number;
}

type AnswerMap = Record<number, Record<string, any>>;


function fmtSeconds(s: number): string {
  if (s <= 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}


export function StudentSolveView({ psid }: Props) {
  const toast = useToast();
  const [data, setData] = useState<StudentViewResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<SubmitResult | null>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const autoSubmittedRef = useRef(false);
  // LLM 채점 polling — submit 후 llm_grading_started면 시작
  const [llmPolling, setLlmPolling] = useState(false);
  const [llmStatusByPid, setLlmStatusByPid] = useState<Record<number, MyAttemptRow>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<StudentViewResp>(
        `/api/courseware/problem-sets/${psid}/student-view`,
      );
      setData(res);
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

  // ── 셔플 — settings.shuffle_questions 켜져있고 학생일 때만, 시도(attempts_used)별 고정
  const orderedProblems: ProblemForStudent[] = useMemo(() => {
    if (!data) return [];
    const shuffleOn = !!data.settings?.shuffle_questions;
    if (!shuffleOn) return data.problems;
    const key = `courseware-order-${psid}-${data.attempts_used}`;
    const cached = typeof window !== "undefined" ? sessionStorage.getItem(key) : null;
    let order: number[];
    if (cached) {
      try {
        order = JSON.parse(cached);
      } catch {
        order = data.problems.map((_, i) => i);
      }
    } else {
      order = data.problems.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      if (typeof window !== "undefined") {
        sessionStorage.setItem(key, JSON.stringify(order));
      }
    }
    return order
      .map((i) => data.problems[i])
      .filter((p): p is ProblemForStudent => !!p);
  }, [data, psid]);

  const handleSubmit = useCallback(async (auto = false) => {
    if (!data) return;
    if (!auto) {
      const unanswered = data.problems.filter((p) => {
        const a = answers[p.id] || {};
        if (p.type === "multiple_choice") return !(a.selected?.length);
        if (p.type === "numeric") return a.value === "" || a.value === undefined || a.value === null;
        return !(a.text || "").trim();
      });
      if (unanswered.length > 0) {
        if (!confirm(`${unanswered.length}문제가 비어있습니다. 그래도 제출할까요?`)) return;
      }
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
      // timer + shuffle 캐시 정리 (제출 끝났으니 다음 attempt는 새로)
      if (typeof window !== "undefined") {
        const startKey = `courseware-start-${psid}-${data.attempts_used}`;
        const orderKey = `courseware-order-${psid}-${data.attempts_used}`;
        sessionStorage.removeItem(startKey);
        sessionStorage.removeItem(orderKey);
      }
      // LLM 채점 시작 → polling
      if (res.llm_grading_started) {
        setLlmPolling(true);
      }
      toast.show(
        (auto ? "시간 초과 자동 제출 — " : "제출 완료 — ") +
          `자동채점 ${res.auto_correct}/${res.auto_graded}` +
          (res.manual_pending ? ` · 수동 ${res.manual_pending}건 대기` : ""),
        "success",
      );
      load();
    } catch (e: any) {
      toast.show(e?.detail || "제출 실패", "error");
    } finally {
      setSubmitting(false);
    }
  }, [data, answers, psid, toast, load]);

  // ── LLM 채점 polling — submit 후 활성 (5초 주기). 모두 done/failed면 정지.
  useEffect(() => {
    if (!llmPolling) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await api.get<{ items: MyAttemptRow[]; attempts_used: number }>(
          `/api/courseware/problem-sets/${psid}/my-attempts`,
        );
        if (cancelled) return;
        const latestN = Math.max(...res.items.map((r) => r.attempt_number), 0);
        const latest = res.items.filter((r) => r.attempt_number === latestN);
        const map: Record<number, MyAttemptRow> = {};
        latest.forEach((r) => { map[r.problem_id] = r; });
        setLlmStatusByPid(map);
        const inflight = latest.some(
          (r) => r.grading_status === "pending" || r.grading_status === "running",
        );
        if (!inflight) setLlmPolling(false);
      } catch {
        // best-effort
      }
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [llmPolling, psid]);

  // ── Timer — time_limit_seconds 켜져있을 때
  useEffect(() => {
    if (!data?.time_limit_seconds) {
      setTimeLeft(null);
      return;
    }
    if (data.is_past_due || data.attempts_left <= 0) {
      setTimeLeft(null);
      return;
    }
    if (typeof window === "undefined") return;

    const startKey = `courseware-start-${psid}-${data.attempts_used}`;
    let startMs = parseInt(sessionStorage.getItem(startKey) || "0", 10);
    if (!startMs) {
      startMs = Date.now();
      sessionStorage.setItem(startKey, String(startMs));
    }
    const limit = data.time_limit_seconds;

    const tick = () => {
      const elapsed = Math.floor((Date.now() - startMs) / 1000);
      const left = limit - elapsed;
      setTimeLeft(Math.max(0, left));
      if (left <= 0 && !autoSubmittedRef.current) {
        autoSubmittedRef.current = true;
        handleSubmit(true);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [data?.time_limit_seconds, data?.attempts_used, data?.is_past_due, data?.attempts_left, psid, handleSubmit]);

  if (loading) return <div className="text-text-tertiary">로딩 중...</div>;
  if (!data) return null;

  const cantSubmit = data.is_past_due || data.attempts_left <= 0;
  const dueText = data.due_date
    ? new Date(data.due_date).toLocaleString("ko-KR")
    : "기한 없음";

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Timer sticky bar */}
      {timeLeft !== null && !cantSubmit && (
        <div
          className={`sticky top-2 z-10 flex items-center justify-between px-4 py-2 rounded-lg shadow-md border-2 ${
            timeLeft <= 60
              ? "bg-red-50 border-red-300"
              : timeLeft <= 300
                ? "bg-amber-50 border-amber-300"
                : "bg-emerald-50 border-emerald-300"
          }`}
        >
          <div className="flex items-center gap-2">
            <Timer
              size={18}
              className={
                timeLeft <= 60 ? "text-red-700" : timeLeft <= 300 ? "text-amber-700" : "text-emerald-700"
              }
            />
            <span className="text-body font-semibold">남은 시간</span>
          </div>
          <span
            className={`text-h3 font-mono font-bold tabular-nums ${
              timeLeft <= 60 ? "text-red-700" : timeLeft <= 300 ? "text-amber-700" : "text-emerald-700"
            }`}
          >
            {fmtSeconds(timeLeft)}
          </span>
        </div>
      )}

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
          {data.time_limit_seconds && (
            <span className="flex items-center gap-1">
              <Timer size={12} /> 제한 {Math.floor(data.time_limit_seconds / 60)}분
            </span>
          )}
          {data.settings?.shuffle_questions && (
            <span className="px-1.5 py-0.5 bg-cream-100 rounded text-[10px]">
              문제 순서 random
            </span>
          )}
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

      {/* LLM 채점 진행 표시 (제출 직후 polling 중) */}
      {llmPolling && (
        <div className="bg-sky-50 border border-sky-200 rounded-lg p-3 flex items-center gap-2">
          <Loader2 size={16} className="text-sky-700 animate-spin" />
          <span className="text-caption text-sky-900">
            AI 채점 진행 중… (essay/주관식 문제 — 보통 10~30초 소요)
          </span>
        </div>
      )}

      {/* 문제 list (셔플된 순서) */}
      {orderedProblems.map((p, i) => (
        <ProblemCard
          key={p.id}
          index={i}
          problem={p}
          answer={answers[p.id] || {}}
          onChange={(next) => setAnswers((prev) => ({ ...prev, [p.id]: next }))}
          revealed={data.solution_revealed}
          lastResult={lastResult?.results.find((r) => r.problem_id === p.id)}
          llmStatus={llmStatusByPid[p.id]}
          disabled={cantSubmit}
        />
      ))}

      {/* 제출 */}
      {!cantSubmit && (
        <div className="sticky bottom-4 flex justify-end">
          <button
            type="button"
            onClick={() => handleSubmit(false)}
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
    llm_grading?: boolean;
  };
  llmStatus?: MyAttemptRow;
  disabled?: boolean;
}

function LLMStatusBadge({ status }: { status: MyAttemptRow }) {
  const s = status.grading_status;
  if (s === "pending") {
    return (
      <span className="text-text-tertiary flex items-center gap-1">
        <Bot size={12} /> AI 채점 대기…
      </span>
    );
  }
  if (s === "running") {
    return (
      <span className="text-sky-700 flex items-center gap-1">
        <Loader2 size={12} className="animate-spin" /> AI 채점 중…
      </span>
    );
  }
  if (s === "done") {
    return (
      <span className="text-emerald-700 flex items-center gap-1 font-semibold">
        <Bot size={12} /> AI 채점 완료
        {status.manual_score !== null && (
          <span>({Math.round(status.manual_score * 100)}점)</span>
        )}
      </span>
    );
  }
  if (s === "failed") {
    return (
      <span className="text-red-700 flex items-center gap-1">
        <Bot size={12} /> AI 채점 실패 (교사 검토 필요)
      </span>
    );
  }
  return <span className="text-amber-700 font-semibold">수동 채점 대기</span>;
}


function ProblemCard({
  index, problem, answer, onChange, revealed, lastResult, llmStatus, disabled,
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
            {/* LLM 채점 상태 우선 표시 (수동 채점 대기보다 우선) */}
            {lastResult.is_correct === null && llmStatus && (
              <LLMStatusBadge status={llmStatus} />
            )}
            {lastResult.is_correct === null && !llmStatus && lastResult.has_manual_pending && (
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
                <span className="text-body"><InlineMathText text={c} /></span>
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

      {/* LLM 채점 피드백 (done 시) */}
      {llmStatus?.grading_status === "done" && llmStatus.manual_feedback && (
        <div className="mt-3 pt-3 border-t border-cream-300 bg-cream-50 rounded p-2 -mx-2">
          <div className="flex items-center gap-1 text-caption text-text-tertiary font-semibold mb-1">
            <Bot size={12} /> AI 피드백
            {llmStatus.manual_score !== null && (
              <span className="ml-1 text-text-secondary">
                ({Math.round(llmStatus.manual_score * 100)}점)
              </span>
            )}
          </div>
          <div className="text-caption text-text-secondary whitespace-pre-wrap">
            {llmStatus.manual_feedback}
          </div>
        </div>
      )}

      {/* 정답·해설 (revealed일 때만) */}
      {revealed && (
        <div className="mt-3 pt-3 border-t border-border-default space-y-2">
          {problem.answer && (
            <div className="text-caption">
              <span className="text-text-tertiary font-semibold">정답:</span>{" "}
              <span className="text-text-primary"><InlineMathText text={problem.answer} /></span>
            </div>
          )}
          {problem.solution && (
            <div className="text-caption">
              <div className="text-text-tertiary font-semibold mb-1">해설</div>
              <ProblemContent content={problem.solution} className="text-text-secondary whitespace-pre-wrap" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
