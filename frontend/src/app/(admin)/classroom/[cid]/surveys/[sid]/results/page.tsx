"use client";

/**
 * 설문 결과 — 작성자/관리자만 접근 가능.
 *
 * - 응답 수 요약
 * - 질문별 집계:
 *   · 객관식·체크박스: 옵션별 카운트 + horizontal bar
 *   · 평점: 분포 + 평균
 *   · 단답/장문/날짜: 텍스트 리스트
 * - CSV export 버튼 (UTF-8 BOM, Excel 즉시 열림)
 * - 응답자 목록 (실명 모드만)
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft, BarChart3, Download, Lock, Users, Star, CheckSquare, AlignLeft, Calendar,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { downloadSecure } from "@/lib/api/download";

type QType = "short_text" | "long_text" | "single_choice" | "multi_choice" | "rating" | "date";

interface QuestionSummary {
  id: number;
  order: number;
  question_text: string;
  question_type: QType;
  is_required: boolean;
  options: string[];
  rating_max: number;
  response_count: number;
  choice_counts?: Record<string, number>;
  rating_counts?: Record<string, number>;
  rating_avg?: number | null;
  text_values?: string[];
}

interface ResultData {
  survey: {
    id: number;
    title: string;
    is_anonymous: boolean;
    status: string;
  };
  response_count: number;
  questions: QuestionSummary[];
  responses: Array<{
    id: number;
    respondent_id: number | null;
    respondent_name: string | null;
    submitted_at: string | null;
  }>;
}

export default function SurveyResultsPage() {
  const params = useParams();
  const cid = Number(params.cid);
  const sid = Number(params.sid);

  const [data, setData] = useState<ResultData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get<ResultData>(`/api/classroom/surveys/${sid}/results`);
      setData(d);
    } catch (e: any) {
      alert(e?.detail || "결과 조회 실패");
    } finally {
      setLoading(false);
    }
  }, [sid]);

  useEffect(() => { load(); }, [load]);

  const downloadFile = async (kind: "csv" | "xlsx") => {
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8002";
      const res = await fetch(`${apiUrl}/api/classroom/surveys/${sid}/results.${kind}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `survey_${sid}_results.${kind}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(`다운로드 실패: ${e?.message || e}`);
    }
  };

  if (loading) return <div className="text-text-tertiary">로딩 중...</div>;
  if (!data) return null;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-3">
        <Link
          href={`/classroom/${cid}/surveys/${sid}`}
          className="text-caption text-text-tertiary hover:text-accent inline-flex items-center gap-1"
        >
          <ArrowLeft size={12} /> 설문 편집기로
        </Link>
      </div>

      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-title font-semibold flex items-center gap-2">
            <BarChart3 size={20} className="text-accent" />
            {data.survey.title}
          </h1>
          <div className="text-caption text-text-tertiary mt-1 flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1">
              <Users size={11} /> 응답 {data.response_count}건
            </span>
            {data.survey.is_anonymous && (
              <span className="inline-flex items-center gap-1">
                <Lock size={11} /> 익명 설문
              </span>
            )}
            <span>상태: {data.survey.status === "active" ? "응답 중" : "마감"}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => downloadFile("xlsx")}
            className="flex items-center gap-1 px-3 py-1.5 text-caption bg-[#107c41] text-white rounded hover:bg-[#0b6135] whitespace-nowrap"
            title="Excel·구글시트·한컴 셀 호환"
          >
            <Download size={12} /> Excel
          </button>
          <button
            onClick={() => downloadFile("csv")}
            className="flex items-center gap-1 px-3 py-1.5 text-caption bg-bg-secondary text-text-secondary rounded hover:bg-cream-200 whitespace-nowrap border border-border-default"
          >
            <Download size={12} /> CSV
          </button>
        </div>
      </div>

      {/* 질문별 집계 */}
      <div className="space-y-3">
        {data.questions.map((q, idx) => (
          <QuestionResultCard key={q.id} q={q} index={idx} />
        ))}
      </div>

      {/* 응답자 목록 (실명 모드만) */}
      {!data.survey.is_anonymous && data.responses.length > 0 && (
        <div className="mt-6 border border-border-default rounded-lg p-4 bg-bg-primary">
          <h3 className="text-body font-semibold mb-2 flex items-center gap-1">
            <Users size={14} /> 응답자 ({data.responses.length})
          </h3>
          <div className="space-y-1 max-h-[300px] overflow-y-auto text-caption">
            {data.responses.map((r) => (
              <div key={r.id} className="flex items-center justify-between px-2 py-1 hover:bg-bg-secondary rounded">
                <span>{r.respondent_name || `#${r.respondent_id || "-"}`}</span>
                <span className="text-text-tertiary text-[11px]">
                  {r.submitted_at?.slice(0, 16).replace("T", " ")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


function QuestionResultCard({ q, index }: { q: QuestionSummary; index: number }) {
  const typeIcon = {
    single_choice: CheckSquare,
    multi_choice: CheckSquare,
    rating: Star,
    short_text: AlignLeft,
    long_text: AlignLeft,
    date: Calendar,
  } as const;
  const Icon = (typeIcon as any)[q.question_type] || AlignLeft;

  return (
    <div className="border border-border-default rounded-lg p-4 bg-bg-primary">
      <div className="mb-3">
        <div className="flex items-center gap-2 text-caption text-text-tertiary mb-1">
          <Icon size={11} />
          <span>Q{index + 1}</span>
          <span className="text-[10px] px-1 py-0.5 bg-cream-200 rounded text-text-secondary">
            응답 {q.response_count}건
          </span>
        </div>
        <div className="text-body text-text-primary whitespace-pre-wrap">
          {q.question_text}
        </div>
      </div>

      {(q.question_type === "single_choice" || q.question_type === "multi_choice") && (
        <ChoiceBars
          counts={q.choice_counts || {}}
          options={q.options}
          total={q.response_count}
        />
      )}

      {q.question_type === "rating" && (
        <RatingDistribution
          counts={q.rating_counts || {}}
          ratingMax={q.rating_max}
          avg={q.rating_avg ?? null}
          total={q.response_count}
        />
      )}

      {(q.question_type === "short_text" || q.question_type === "long_text" || q.question_type === "date") && (
        <TextAnswerList values={q.text_values || []} />
      )}
    </div>
  );
}


function ChoiceBars({
  counts, options, total,
}: { counts: Record<string, number>; options: string[]; total: number }) {
  // 옵션 외 답이 들어왔을 때 표시하기 위해 union
  const allKeys = Array.from(new Set([...options, ...Object.keys(counts)]));
  return (
    <div className="space-y-2">
      {allKeys.map((opt) => {
        const c = counts[opt] || 0;
        const pct = total > 0 ? Math.round((c / total) * 100) : 0;
        return (
          <div key={opt}>
            <div className="flex items-center justify-between text-caption mb-0.5">
              <span className="truncate">{opt}</span>
              <span className="text-text-tertiary tabular-nums">{c} ({pct}%)</span>
            </div>
            <div className="h-2 bg-bg-secondary rounded overflow-hidden">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
      {allKeys.length === 0 && (
        <div className="text-caption text-text-tertiary">아직 응답 없음</div>
      )}
    </div>
  );
}


function RatingDistribution({
  counts, ratingMax, avg, total,
}: {
  counts: Record<string, number>;
  ratingMax: number;
  avg: number | null;
  total: number;
}) {
  return (
    <div>
      <div className="text-caption text-text-secondary mb-2">
        평균: <b className="text-accent">{avg !== null ? avg.toFixed(2) : "—"}</b>
        <span className="text-text-tertiary ml-2">/ {ratingMax}</span>
      </div>
      <div className="space-y-1">
        {Array.from({ length: ratingMax }, (_, i) => i + 1).map((v) => {
          const c = counts[String(v)] || 0;
          const pct = total > 0 ? Math.round((c / total) * 100) : 0;
          return (
            <div key={v} className="flex items-center gap-2 text-caption">
              <span className="w-6 text-right text-text-tertiary tabular-nums">{v}</span>
              <div className="flex-1 h-2 bg-bg-secondary rounded overflow-hidden">
                <div className="h-full bg-amber-400" style={{ width: `${pct}%` }} />
              </div>
              <span className="w-12 text-right text-text-tertiary tabular-nums">
                {c} ({pct}%)
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}


function TextAnswerList({ values }: { values: string[] }) {
  if (values.length === 0) {
    return <div className="text-caption text-text-tertiary">아직 응답 없음</div>;
  }
  return (
    <div className="space-y-1 max-h-[300px] overflow-y-auto">
      {values.map((v, i) => (
        <div
          key={i}
          className="text-body text-text-primary px-3 py-2 bg-bg-secondary rounded whitespace-pre-wrap"
        >
          {v}
        </div>
      ))}
    </div>
  );
}
