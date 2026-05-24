"use client";

/**
 * 교사 문제 세트 결과·관리 페이지.
 *
 * - 상단: 메타 (제목/마감/재응시/상태) + 게시·마감 토글
 * - 학생별 best_score 테이블
 * - 문제별 정답률
 * - 수동 채점 모달 (essay/manual/llm)
 * - 결과 CSV/XLSX 다운로드
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Download, FileSpreadsheet, CheckCircle2, XCircle, Pencil, Bot } from "lucide-react";
import { api } from "@/lib/api/client";
import { useToast } from "@/components/ui/Toast";
import { ManualGradeModal } from "@/components/courseware/ManualGradeModal";
import { LLMGradeModal } from "@/components/courseware/LLMGradeModal";
import { ProblemContent, InlineMathText } from "@/components/courseware/ProblemContent";
import type { ProblemSetDetail, ResultsResp } from "@/components/courseware/types";
import { STATUS_LABEL, STATUS_BADGE_TONE } from "@/components/courseware/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8002";

export default function CoursewareResultsPage() {
  const params = useParams();
  const toast = useToast();
  const cid = Number(params.cid);
  const psid = Number(params.psid);

  const [detail, setDetail] = useState<ProblemSetDetail | null>(null);
  const [results, setResults] = useState<ResultsResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [manualSid, setManualSid] = useState<number | null>(null);
  const [showLLMGrade, setShowLLMGrade] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, r] = await Promise.all([
        api.get<ProblemSetDetail>(`/api/courseware/problem-sets/${psid}`),
        api.get<ResultsResp>(`/api/courseware/problem-sets/${psid}/results`),
      ]);
      setDetail(d);
      setResults(r);
    } catch (e: any) {
      toast.show(e?.detail || "조회 실패", "error");
    } finally {
      setLoading(false);
    }
  }, [psid, toast]);

  useEffect(() => { load(); }, [load]);

  const handlePublish = async () => {
    try {
      await api.post(`/api/courseware/problem-sets/${psid}/publish`);
      toast.show("게시됨", "success");
      load();
    } catch (e: any) { toast.show(e?.detail || "실패", "error"); }
  };
  const handleClose = async () => {
    if (!confirm("마감 후엔 학생 제출 불가. 계속할까요?")) return;
    try {
      await api.post(`/api/courseware/problem-sets/${psid}/close`);
      toast.show("마감됨", "success");
      load();
    } catch (e: any) { toast.show(e?.detail || "실패", "error"); }
  };

  const downloadResults = async (format: "csv" | "xlsx") => {
    try {
      const token = localStorage.getItem("access_token");
      const res = await fetch(
        `${API_URL}/api/courseware/problem-sets/${psid}/results.${format}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `problem-set-${psid}-results.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.show(`다운로드 실패: ${e?.message || e}`, "error");
    }
  };

  if (loading) return <div className="text-text-tertiary">로딩 중...</div>;
  if (!detail) return null;

  // 자동채점 가능 문제 / 수동채점 필요 문제 카운트
  const manualCount = detail.problems.filter((p) => {
    const g = (p.answer_data?.grader_type || "").toLowerCase();
    return g === "essay" || g === "manual" || g === "llm";
  }).length;

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <Link
        href={`/classroom/${cid}`}
        className="inline-flex items-center gap-1 text-caption text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft size={14} /> 강좌로 돌아가기
      </Link>

      {/* 메타 */}
      <div className="bg-bg-primary border border-border-default rounded-lg p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-h2 truncate">{detail.title}</h1>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_BADGE_TONE[detail.status]}`}>
                {STATUS_LABEL[detail.status]}
              </span>
            </div>
            {detail.description && (
              <p className="text-body text-text-secondary mb-2">{detail.description}</p>
            )}
            <div className="flex flex-wrap gap-3 text-caption text-text-tertiary">
              <span>{detail.problem_count}문제 · 수동채점 {manualCount}건</span>
              {detail.due_date && (
                <span>마감 {new Date(detail.due_date).toLocaleString("ko-KR")}</span>
              )}
              <span>재응시 {detail.max_attempts}회</span>
              <span>{detail.show_solution_after_due ? "마감 후 정답 공개" : "정답 비공개"}</span>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {detail.status === "draft" && (
              <button
                type="button"
                onClick={handlePublish}
                className="text-caption px-3 py-1.5 border border-emerald-300 text-emerald-700 rounded hover:bg-emerald-50"
              >
                게시
              </button>
            )}
            {detail.status === "published" && (
              <button
                type="button"
                onClick={handleClose}
                className="text-caption px-3 py-1.5 border border-amber-300 text-amber-700 rounded hover:bg-amber-50"
              >
                마감
              </button>
            )}
            {manualCount > 0 && (
              <button
                type="button"
                onClick={() => setShowLLMGrade(true)}
                className="text-caption px-3 py-1.5 border border-sky-300 text-sky-700 rounded hover:bg-sky-50 flex items-center gap-1"
                title="essay/주관식 문제 LLM 일괄 채점"
              >
                <Bot size={12} /> AI 채점
              </button>
            )}
            <button
              type="button"
              onClick={() => downloadResults("csv")}
              className="text-caption px-3 py-1.5 border border-border-default rounded hover:bg-bg-secondary flex items-center gap-1"
            >
              <Download size={12} /> CSV
            </button>
            <button
              type="button"
              onClick={() => downloadResults("xlsx")}
              className="text-caption px-3 py-1.5 bg-emerald-600 text-white rounded hover:opacity-90 flex items-center gap-1"
            >
              <FileSpreadsheet size={12} /> Excel
            </button>
          </div>
        </div>
      </div>

      {/* 학생별 점수 */}
      <div className="bg-bg-primary border border-border-default rounded-lg p-5">
        <h2 className="text-h3 mb-3">학생별 결과 ({results?.students.length ?? 0}명 제출)</h2>
        {!results || results.students.length === 0 ? (
          <div className="text-caption text-text-tertiary py-4 text-center">
            아직 제출한 학생이 없습니다
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-body">
              <thead>
                <tr className="border-b border-border-default text-caption text-text-tertiary">
                  <th className="text-left py-2 px-2">학생</th>
                  <th className="text-right py-2 px-2">시도</th>
                  <th className="text-right py-2 px-2">최고점수</th>
                  <th className="text-left py-2 px-2">최근시도</th>
                  <th className="text-right py-2 px-2">동작</th>
                </tr>
              </thead>
              <tbody>
                {results.students.map((s) => (
                  <tr key={s.student_id} className="border-b border-border-default last:border-0">
                    <td className="py-2 px-2">{s.name}</td>
                    <td className="py-2 px-2 text-right">{s.attempts_count}</td>
                    <td className="py-2 px-2 text-right font-semibold">{s.best_score.toFixed(1)}</td>
                    <td className="py-2 px-2 text-caption text-text-tertiary">
                      {s.latest_attempt_at
                        ? new Date(s.latest_attempt_at).toLocaleString("ko-KR")
                        : "-"}
                    </td>
                    <td className="py-2 px-2 text-right">
                      {manualCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setManualSid(s.student_id)}
                          className="text-caption px-2 py-1 border border-border-default rounded hover:bg-bg-secondary inline-flex items-center gap-1"
                        >
                          <Pencil size={11} /> 수동채점
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 문제별 정답률 */}
      <div className="bg-bg-primary border border-border-default rounded-lg p-5">
        <h2 className="text-h3 mb-3">문제별 정답률</h2>
        {!results || results.problems.length === 0 ? (
          <div className="text-caption text-text-tertiary py-4 text-center">제출 없음</div>
        ) : (
          <div className="space-y-2">
            {detail.problems.map((p, i) => {
              const r = results.problems.find((x) => x.problem_id === p.id);
              const total = r?.total_submissions ?? 0;
              const correct = r?.correct_count ?? 0;
              const acc = r?.accuracy ?? 0;
              const pct = Math.round(acc * 100);
              return (
                <div key={p.id} className="border border-border-default rounded p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 text-caption">
                      <span className="font-semibold">Q{i + 1}</span>
                      <span className="text-text-tertiary">{p.type}</span>
                    </div>
                    <div className="flex items-center gap-2 text-caption">
                      {acc >= 0.8 ? (
                        <CheckCircle2 size={14} className="text-emerald-600" />
                      ) : acc >= 0.5 ? (
                        <CheckCircle2 size={14} className="text-amber-600" />
                      ) : (
                        <XCircle size={14} className="text-red-600" />
                      )}
                      <span>{correct}/{total} ({pct}%)</span>
                    </div>
                  </div>
                  <ProblemContent content={p.content} className="text-body mb-1 line-clamp-2" />
                  {p.answer && (
                    <div className="text-caption text-text-tertiary">정답: <InlineMathText text={p.answer} /></div>
                  )}
                  <div className="mt-2 h-1.5 bg-bg-secondary rounded overflow-hidden">
                    <div
                      className={`h-full ${
                        acc >= 0.8 ? "bg-emerald-500" : acc >= 0.5 ? "bg-amber-500" : "bg-red-500"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {manualSid !== null && detail && (
        <ManualGradeModal
          psid={psid}
          studentId={manualSid}
          problems={detail.problems}
          onClose={() => setManualSid(null)}
          onSaved={() => { setManualSid(null); load(); }}
        />
      )}

      {showLLMGrade && (
        <LLMGradeModal
          psid={psid}
          onClose={() => setShowLLMGrade(false)}
          onDone={() => { setShowLLMGrade(false); load(); }}
        />
      )}
    </div>
  );
}
