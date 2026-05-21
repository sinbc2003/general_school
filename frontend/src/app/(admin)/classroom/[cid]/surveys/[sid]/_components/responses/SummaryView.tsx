"use client";

import { QuestionResult } from "./QuestionResult";
import type { ResultData } from "./types";

/** 요약 sub-tab — 모든 질문을 시각화로 한 화면에. */
export function SummaryView({ data }: { data: ResultData }) {
  if (data.questions.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-10 text-center text-caption text-text-tertiary">
        질문이 없는 설문입니다.
      </div>
    );
  }
  if (data.response_count === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-10 text-center text-text-tertiary">
        아직 응답이 없습니다.
      </div>
    );
  }
  return (
    <div>
      {data.questions.map((q, i) => (
        <QuestionResult key={q.id} q={q} index={i} totalResponseCount={data.response_count} />
      ))}
    </div>
  );
}
