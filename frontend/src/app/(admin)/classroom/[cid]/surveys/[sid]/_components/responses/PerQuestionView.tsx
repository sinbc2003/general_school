"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { QuestionResult } from "./QuestionResult";
import type { ResultData } from "./types";

/** 질문별 sub-tab — 드롭다운 + 이전/다음 네비. */
export function PerQuestionView({ data }: { data: ResultData }) {
  const [idx, setIdx] = useState(0);

  if (data.questions.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-[#e8eaed] shadow-[0_1px_2px_0_rgba(60,64,67,0.08)] p-10 text-center text-caption text-text-tertiary">
        질문이 없습니다.
      </div>
    );
  }
  const q = data.questions[idx];

  return (
    <div>
      <div className="bg-white rounded-lg border border-[#e8eaed] shadow-[0_1px_2px_0_rgba(60,64,67,0.08)] p-3 mb-3 flex items-center gap-2">
        <button
          onClick={() => setIdx(Math.max(0, idx - 1))}
          disabled={idx === 0}
          className="p-1 rounded hover:bg-bg-secondary disabled:opacity-30 disabled:hover:bg-transparent"
          aria-label="이전 질문"
        >
          <ChevronLeft size={16} />
        </button>
        <select
          value={idx}
          onChange={(e) => setIdx(Number(e.target.value))}
          className="flex-1 px-3 py-1.5 text-body bg-transparent border border-border-default rounded focus:border-accent outline-none"
        >
          {data.questions.map((qq, i) => (
            <option key={qq.id} value={i}>
              {i + 1}. {qq.question_text.length > 50 ? qq.question_text.slice(0, 50) + "…" : qq.question_text}
            </option>
          ))}
        </select>
        <button
          onClick={() => setIdx(Math.min(data.questions.length - 1, idx + 1))}
          disabled={idx === data.questions.length - 1}
          className="p-1 rounded hover:bg-bg-secondary disabled:opacity-30 disabled:hover:bg-transparent"
          aria-label="다음 질문"
        >
          <ChevronRight size={16} />
        </button>
        <span className="text-caption text-text-tertiary tabular-nums px-2">
          {idx + 1} / {data.questions.length}
        </span>
      </div>

      <QuestionResult q={q} index={idx} totalResponseCount={data.response_count} />
    </div>
  );
}
