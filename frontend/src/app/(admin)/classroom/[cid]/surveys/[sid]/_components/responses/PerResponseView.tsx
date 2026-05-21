"use client";

import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight, User as UserIcon, Lock } from "lucide-react";
import type { ResultData, ResponseRow, QuestionSummary } from "./types";

/** 개별 응답 보기 — 응답자 1명씩 전체 답변. */
export function PerResponseView({ data }: { data: ResultData }) {
  const [idx, setIdx] = useState(0);

  if (data.responses.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-[#e8eaed] shadow-[0_1px_2px_0_rgba(60,64,67,0.08)] p-10 text-center text-text-tertiary">
        아직 응답이 없습니다.
      </div>
    );
  }

  const resp = data.responses[idx];
  const qById = useMemo(() => {
    const m: Record<number, QuestionSummary> = {};
    for (const q of data.questions) m[q.id] = q;
    return m;
  }, [data.questions]);
  const answerByQ = useMemo(() => {
    const m: Record<number, ResponseRow["answers"][number]> = {};
    for (const a of resp.answers) m[a.question_id] = a;
    return m;
  }, [resp]);

  const subTime =
    resp.submitted_at?.slice(0, 16).replace("T", " ") || "—";

  return (
    <div>
      {/* 네비 — 이전/다음/번호 선택 */}
      <div className="bg-white rounded-lg border border-[#e8eaed] shadow-[0_1px_2px_0_rgba(60,64,67,0.08)] p-3 mb-3 flex items-center gap-3 flex-wrap">
        <button
          onClick={() => setIdx(Math.max(0, idx - 1))}
          disabled={idx === 0}
          className="p-1.5 rounded hover:bg-bg-secondary disabled:opacity-30 disabled:hover:bg-transparent"
          aria-label="이전 응답"
        >
          <ChevronLeft size={16} />
        </button>
        <select
          value={idx}
          onChange={(e) => setIdx(Number(e.target.value))}
          className="px-3 py-1.5 text-body bg-transparent border border-border-default rounded focus:border-accent outline-none flex-shrink-0"
        >
          {data.responses.map((r, i) => (
            <option key={r.id} value={i}>
              응답 {i + 1}
              {data.survey.is_anonymous ? "" : ` — ${r.respondent_name || "(이름 없음)"}`}
            </option>
          ))}
        </select>
        <button
          onClick={() => setIdx(Math.min(data.responses.length - 1, idx + 1))}
          disabled={idx === data.responses.length - 1}
          className="p-1.5 rounded hover:bg-bg-secondary disabled:opacity-30 disabled:hover:bg-transparent"
          aria-label="다음 응답"
        >
          <ChevronRight size={16} />
        </button>
        <span className="text-caption text-text-tertiary tabular-nums">
          {idx + 1} / {data.responses.length}
        </span>
        <div className="flex-1" />
        <div className="text-caption text-text-tertiary inline-flex items-center gap-2">
          {data.survey.is_anonymous ? (
            <>
              <Lock size={12} /> 익명 응답
            </>
          ) : (
            <>
              <UserIcon size={12} />
              <span className="text-text-primary font-medium">
                {resp.respondent_name || "(이름 없음)"}
              </span>
            </>
          )}
          <span>· 제출 {subTime}</span>
        </div>
      </div>

      {/* 각 질문 + 응답 */}
      <div className="space-y-3">
        {data.questions.map((q, i) => {
          const a = answerByQ[q.id];
          return (
            <div key={q.id} className="bg-white rounded-lg border border-[#e8eaed] shadow-[0_1px_2px_0_rgba(60,64,67,0.08)] p-5">
              <div className="text-caption text-text-tertiary mb-1">Q{i + 1}</div>
              <div className="text-body font-medium text-text-primary mb-3 whitespace-pre-wrap">
                {q.question_text}
                {q.is_required && <span className="text-red-500 ml-1">*</span>}
              </div>
              <AnswerDisplay q={q} a={a} />
            </div>
          );
        })}
      </div>
    </div>
  );
}


function AnswerDisplay({
  q,
  a,
}: {
  q: QuestionSummary;
  a: ResponseRow["answers"][number] | undefined;
}) {
  if (!a) {
    return <div className="text-caption text-text-tertiary italic">— 답변 없음 —</div>;
  }
  if (q.question_type === "single_choice" || q.question_type === "multi_choice") {
    const vals = a.choice_values || [];
    if (vals.length === 0) {
      return <div className="text-caption text-text-tertiary italic">— 답변 없음 —</div>;
    }
    return (
      <ul className="space-y-1">
        {vals.map((v, i) => (
          <li key={i} className="text-body text-text-primary inline-flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0" />
            {v}
          </li>
        ))}
      </ul>
    );
  }
  if (q.question_type === "rating") {
    if (a.rating_value === null || a.rating_value === undefined) {
      return <div className="text-caption text-text-tertiary italic">— 답변 없음 —</div>;
    }
    return (
      <div className="text-body inline-flex items-center gap-1">
        <span className="text-accent font-semibold text-title">{a.rating_value}</span>
        <span className="text-text-tertiary">/ {q.rating_max}</span>
      </div>
    );
  }
  // text / date / long_text
  if (!a.text_value) {
    return <div className="text-caption text-text-tertiary italic">— 답변 없음 —</div>;
  }
  return (
    <div className="text-body text-text-primary px-3 py-2.5 bg-bg-secondary rounded whitespace-pre-wrap break-words">
      {a.text_value}
    </div>
  );
}
