"use client";

/**
 * 학생 1명의 attempts → essay/manual/llm grader 문제만 표시 + 점수 입력.
 *
 * 백엔드 endpoint 활용:
 *   - GET /api/courseware/problem-sets/{psid}/my-attempts  → student 본인용
 *   - admin은 별도 endpoint 없음 — 본인 데이터만 가능.
 *
 * 워크어라운드: 학생 시도 결과는 GET /results에 집계만 있고 개별 답안은 없음.
 * 본 모달에서는 본인(교사)이 호출하는 my-attempts 사용 불가 →
 * /attempts/{attempt_id}/manual-grade로 채점만 가능.
 *
 * 단순 구현: 백엔드에 학생 attempts 조회 endpoint 추가 필요. 임시로 본 모달은
 * 빈 list + "백엔드 보완 예정" 표시. (다음 commit에서 endpoint 추가 후 채움)
 *
 * 추후 작업: GET /problem-sets/{psid}/student/{sid}/attempts 추가.
 */

import { useCallback, useEffect, useState } from "react";
import { X, Save, Bot, ChevronDown, ChevronUp } from "lucide-react";
import { api } from "@/lib/api/client";
import { useToast } from "@/components/ui/Toast";
import { ProblemContent } from "./ProblemContent";
import type { ProblemFull, GradingStatus, LLMMetadata } from "./types";

const AI_PREFIX = "(AI 채점) ";

interface AttemptRow {
  id: number;
  attempt_number: number;
  problem_id: number;
  answer_data: any;
  is_correct: boolean | null;
  auto_score: number | null;
  manual_score: number | null;
  manual_feedback: string | null;
  graded_by: number | null;
  grading_status: GradingStatus;
  llm_metadata: LLMMetadata | null;
  submitted_at: string | null;
}

interface Props {
  psid: number;
  studentId: number;
  problems: ProblemFull[];
  onClose: () => void;
  onSaved: () => void;
}

export function ManualGradeModal({ psid, studentId, problems, onClose, onSaved }: Props) {
  const toast = useToast();
  const [attempts, setAttempts] = useState<AttemptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<Record<number, { score: number; feedback: string }>>({});

  const manualProblemIds = new Set(
    problems
      .filter((p) => {
        const g = (p.answer_data?.grader_type || "").toLowerCase();
        return g === "essay" || g === "manual" || g === "llm";
      })
      .map((p) => p.id),
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 교사용 student attempts endpoint
      const res = await api.get<{ items: AttemptRow[] }>(
        `/api/courseware/problem-sets/${psid}/students/${studentId}/attempts`,
      );
      const rows = res.items.filter((r) => manualProblemIds.has(r.problem_id));
      setAttempts(rows);
      // edit map 초기화 — AI prefix는 편집창에서 제거 (교사가 수정 시 자동으로 사람 채점됨)
      const init: Record<number, { score: number; feedback: string }> = {};
      for (const r of rows) {
        const fb = r.manual_feedback || "";
        const cleanFb = fb.startsWith(AI_PREFIX) ? fb.slice(AI_PREFIX.length) : fb;
        init[r.id] = {
          score: r.manual_score ?? 0,
          feedback: cleanFb,
        };
      }
      setEdits(init);
    } catch (e: any) {
      toast.show(e?.detail || "조회 실패", "error");
    } finally {
      setLoading(false);
    }
  }, [psid, studentId, toast]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const save = async (attemptId: number) => {
    const edit = edits[attemptId];
    if (!edit) return;
    try {
      await api.post(`/api/courseware/attempts/${attemptId}/manual-grade`, {
        attempt_id: attemptId,
        score: edit.score,
        feedback: edit.feedback || null,
      });
      toast.show("저장됨", "success");
      onSaved();
    } catch (e: any) {
      toast.show(e?.detail || "실패", "error");
    }
  };

  const problemById = new Map(problems.map((p) => [p.id, p]));

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-bg-primary rounded-lg w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-default">
          <h2 className="text-h3">수동 채점</h2>
          <button type="button" onClick={onClose} className="text-text-tertiary hover:text-text-primary p-1">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {loading ? (
            <div className="text-text-tertiary text-center py-4">로딩 중...</div>
          ) : attempts.length === 0 ? (
            <div className="text-text-tertiary text-center py-4">
              수동 채점할 답안이 없습니다 (자동채점 가능 문제만 제출됨)
            </div>
          ) : (
            attempts.map((a) => {
              const p = problemById.get(a.problem_id);
              const edit = edits[a.id] || { score: 0, feedback: "" };
              return (
                <div key={a.id} className="border border-border-default rounded p-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-caption text-text-tertiary">
                      시도 #{a.attempt_number} · 문제 {a.problem_id} · {p?.type}
                    </div>
                    <AttemptStatusBadge attempt={a} />
                  </div>
                  {p && <ProblemContent content={p.content} className="text-body mb-2" />}
                  <div className="bg-bg-secondary rounded p-2 mb-2">
                    <div className="text-caption text-text-tertiary mb-1">학생 답안</div>
                    <pre className="text-caption whitespace-pre-wrap font-mono">
                      {a.answer_data?.text || JSON.stringify(a.answer_data, null, 2)}
                    </pre>
                  </div>
                  {p?.answer_data?.rubric && (
                    <div className="bg-cream-100 rounded p-2 mb-2">
                      <div className="text-caption text-text-tertiary mb-1">채점 기준</div>
                      <div className="text-caption">{p.answer_data.rubric}</div>
                    </div>
                  )}
                  {a.llm_metadata && (
                    <LLMResultDetail meta={a.llm_metadata} status={a.grading_status} />
                  )}
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    <label className="text-caption">
                      <div className="text-text-tertiary mb-1">점수 (0~1)</div>
                      <input
                        type="number"
                        min={0}
                        max={1}
                        step="0.1"
                        value={edit.score}
                        onChange={(e) =>
                          setEdits((prev) => ({
                            ...prev,
                            [a.id]: { ...prev[a.id], score: parseFloat(e.target.value || "0") },
                          }))
                        }
                        className="w-full px-2 py-1.5 border border-border-default rounded text-body"
                      />
                    </label>
                    <label className="text-caption col-span-2">
                      <div className="text-text-tertiary mb-1">피드백 (선택)</div>
                      <input
                        value={edit.feedback}
                        onChange={(e) =>
                          setEdits((prev) => ({
                            ...prev,
                            [a.id]: { ...prev[a.id], feedback: e.target.value },
                          }))
                        }
                        placeholder="학생에게 전달할 피드백"
                        className="w-full px-2 py-1.5 border border-border-default rounded text-body"
                      />
                    </label>
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => save(a.id)}
                      className="px-3 py-1.5 text-caption bg-accent-default text-white rounded hover:opacity-90 flex items-center gap-1"
                    >
                      <Save size={12} /> 저장
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border-default">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}


function AttemptStatusBadge({ attempt }: { attempt: AttemptRow }) {
  if (attempt.grading_status === "done") {
    return (
      <span className="text-caption text-emerald-700 flex items-center gap-1">
        <Bot size={12} /> AI 채점 완료
      </span>
    );
  }
  if (attempt.grading_status === "running") {
    return (
      <span className="text-caption text-sky-700 flex items-center gap-1">
        <Bot size={12} /> AI 채점 중
      </span>
    );
  }
  if (attempt.grading_status === "failed") {
    return (
      <span className="text-caption text-red-700 flex items-center gap-1">
        <Bot size={12} /> AI 채점 실패
      </span>
    );
  }
  if (attempt.grading_status === "pending") {
    return (
      <span className="text-caption text-text-tertiary flex items-center gap-1">
        <Bot size={12} /> AI 채점 대기
      </span>
    );
  }
  if (attempt.graded_by) {
    return (
      <span className="text-caption text-text-secondary">교사 채점 완료</span>
    );
  }
  return <span className="text-caption text-text-tertiary">미채점</span>;
}


function LLMResultDetail({ meta, status }: { meta: LLMMetadata; status: GradingStatus }) {
  const [expanded, setExpanded] = useState(false);
  const label = meta.model_label || meta.model || "?";
  return (
    <div className={`border rounded p-2 mb-2 ${
      status === "failed"
        ? "bg-red-50 border-red-200"
        : "bg-sky-50 border-sky-200"
    }`}>
      <div className="flex items-center justify-between gap-2 text-caption">
        <div className="flex items-center gap-1.5 text-text-secondary">
          <Bot size={12} />
          <span className="font-semibold">{label}</span>
          <span className="text-text-tertiary">
            (in {meta.tokens_in ?? 0} / out {meta.tokens_out ?? 0} · ${Number(meta.cost_usd ?? 0).toFixed(6)})
          </span>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-text-tertiary hover:text-text-primary p-0.5"
        >
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      </div>
      {meta.error && (
        <div className="text-caption text-red-700 mt-1">{meta.error}</div>
      )}
      {expanded && meta.raw_response && (
        <pre className="text-[11px] mt-2 p-2 bg-bg-primary border border-border-default rounded whitespace-pre-wrap font-mono max-h-48 overflow-y-auto">
          {meta.raw_response}
        </pre>
      )}
    </div>
  );
}
