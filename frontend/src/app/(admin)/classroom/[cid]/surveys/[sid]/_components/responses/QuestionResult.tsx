"use client";

/**
 * 한 질문의 응답 시각화 — 요약/질문별 sub-tab 공통.
 *
 * - single_choice, multi_choice: 옵션 수 ≤ 6 → 파이차트, 그 외 → 막대
 * - rating: 1~rating_max 분포 막대 + 평균
 * - short_text, date: 답변별 빈도 막대차트 (값별 카운트)
 * - long_text: 텍스트 리스트 (스크롤)
 */

import { useMemo } from "react";
import { CheckSquare, Star, AlignLeft, Calendar, Copy } from "lucide-react";
import { PieChart } from "../charts/PieChart";
import { BarChart } from "../charts/BarChart";
import type { QuestionSummary } from "./types";

interface Props {
  q: QuestionSummary;
  index: number;
  totalResponseCount: number;
  showCopyButton?: boolean;
}

export function QuestionResult({ q, index, totalResponseCount, showCopyButton = true }: Props) {
  const Icon =
    q.question_type === "rating"
      ? Star
      : q.question_type === "single_choice" || q.question_type === "multi_choice"
      ? CheckSquare
      : q.question_type === "date"
      ? Calendar
      : AlignLeft;

  // text 답변 빈도 집계 (short_text + date용)
  const textFrequency = useMemo(() => {
    if (!q.text_values || q.text_values.length === 0) return [];
    const counts: Record<string, number> = {};
    for (const v of q.text_values) {
      const trimmed = (v || "").trim();
      if (!trimmed) continue;
      counts[trimmed] = (counts[trimmed] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({ label, value }));
  }, [q.text_values]);

  return (
    <div className="bg-white rounded-lg border border-[#e8eaed] shadow-[0_1px_2px_0_rgba(60,64,67,0.08)] p-6 mb-3">
      {/* 헤더 — 질문 텍스트 + 차트 복사 버튼 */}
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-medium text-text-primary whitespace-pre-wrap leading-snug">
            {q.question_text}
            {q.is_required && <span className="text-[#d93025] ml-1">*</span>}
          </div>
          <div className="flex items-center gap-2 text-[12px] text-text-tertiary mt-1.5">
            <Icon size={12} />
            <span>응답 {q.response_count}개</span>
          </div>
        </div>
        {showCopyButton && q.response_count > 0 && (
          <button
            className="text-caption text-accent hover:bg-cream-100 px-2 py-1 rounded inline-flex items-center gap-1 flex-shrink-0"
            onClick={() => {
              // 차트 복사 — 텍스트로 클립보드에 (간단판)
              const text = buildTextSummary(q);
              navigator.clipboard.writeText(text).then(
                () => alert("응답 요약을 클립보드에 복사했습니다."),
                () => alert("복사 실패"),
              );
            }}
            title="응답 요약 텍스트를 클립보드에 복사"
          >
            <Copy size={12} /> 차트 복사
          </button>
        )}
      </div>

      <div className="mt-4">
        {(q.question_type === "single_choice" || q.question_type === "multi_choice") && (
          <ChoiceVisualization q={q} />
        )}

        {q.question_type === "rating" && <RatingViz q={q} />}

        {q.question_type === "short_text" && (
          <ShortTextViz q={q} bars={textFrequency} totalResponseCount={totalResponseCount} />
        )}

        {q.question_type === "date" && (
          <BarChart bars={textFrequency} />
        )}

        {q.question_type === "long_text" && (
          <LongTextList values={q.text_values || []} />
        )}
      </div>
    </div>
  );
}


function ChoiceVisualization({ q }: { q: QuestionSummary }) {
  // 옵션 + 응답에 있는 외부 답 합쳐서
  const counts = q.choice_counts || {};
  const allKeys = Array.from(new Set([...(q.options || []), ...Object.keys(counts)]));
  const slices = allKeys.map((opt) => ({ label: opt, value: counts[opt] || 0 }));
  // 옵션 6개 이하면 파이, 7개 이상이면 막대 — Google Forms 패턴
  if (allKeys.length <= 6 && q.question_type === "single_choice") {
    return <PieChart slices={slices} />;
  }
  // multi_choice는 막대가 가독성 좋음 (한 응답 여러 답 가능)
  return <BarChart bars={slices} />;
}

function RatingViz({ q }: { q: QuestionSummary }) {
  const counts = q.rating_counts || {};
  const bars = Array.from({ length: q.rating_max }, (_, i) => {
    const v = i + 1;
    return { label: String(v), value: counts[String(v)] || 0 };
  });
  return (
    <div>
      <div className="text-caption text-text-secondary mb-3">
        평균: <b className="text-accent text-body">{q.rating_avg !== null && q.rating_avg !== undefined ? q.rating_avg.toFixed(2) : "—"}</b>
        <span className="text-text-tertiary ml-2">/ {q.rating_max}</span>
      </div>
      <BarChart bars={bars} color="#f59e0b" />
    </div>
  );
}

function ShortTextViz({
  q,
  bars,
  totalResponseCount,
}: { q: QuestionSummary; bars: { label: string; value: number }[]; totalResponseCount: number }) {
  // 단답형 — 응답이 모두 다른 값일 가능성 — 그래프와 텍스트 리스트 둘 다 보여줌
  if (bars.length === 0) {
    return <div className="text-caption text-text-tertiary py-2">아직 응답 없음</div>;
  }
  // 모든 값이 1번씩만 나왔으면 그래프 무의미 → 텍스트 리스트만
  const allUnique = bars.every((b) => b.value === 1);
  if (allUnique && bars.length > 6) {
    return <LongTextList values={q.text_values || []} />;
  }
  return <BarChart bars={bars} />;
}

function LongTextList({ values }: { values: string[] }) {
  if (values.length === 0) {
    return <div className="text-caption text-text-tertiary py-2">아직 응답 없음</div>;
  }
  return (
    <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
      {values.map((v, i) => (
        <div
          key={i}
          className="text-body text-text-primary px-3 py-2.5 bg-bg-secondary rounded whitespace-pre-wrap break-words"
        >
          {v}
        </div>
      ))}
    </div>
  );
}


function buildTextSummary(q: QuestionSummary): string {
  const lines: string[] = [];
  lines.push(`[${q.question_text}]`);
  lines.push(`응답 ${q.response_count}개`);
  lines.push("");
  if (q.question_type === "single_choice" || q.question_type === "multi_choice") {
    const c = q.choice_counts || {};
    for (const opt of q.options) {
      const cnt = c[opt] || 0;
      lines.push(`- ${opt}: ${cnt}`);
    }
  } else if (q.question_type === "rating") {
    lines.push(`평균: ${q.rating_avg ?? "—"} / ${q.rating_max}`);
    const c = q.rating_counts || {};
    for (let i = 1; i <= q.rating_max; i++) {
      lines.push(`- ${i}점: ${c[String(i)] || 0}`);
    }
  } else {
    for (const v of (q.text_values || [])) {
      lines.push(`- ${v}`);
    }
  }
  return lines.join("\n");
}
