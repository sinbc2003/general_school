"use client";

/**
 * 질문 유형별 응답 UI "미리보기" (실제 입력은 학생 응답 폼에서).
 *
 * Builder에서 작성한 질문이 어떻게 보일지 시각화.
 */

import type { Question } from "./_types";

export function QuestionPreview({ q }: { q: Question }) {
  const cls = "text-caption text-text-tertiary border border-border-default rounded px-2 py-1 bg-bg-secondary";

  if (q.question_type === "short_text") {
    return <div className={cls}>단답 입력란</div>;
  }
  if (q.question_type === "long_text") {
    return <div className={cls + " min-h-[60px]"}>장문 입력란</div>;
  }
  if (q.question_type === "date") {
    return <div className={cls + " w-32"}>날짜 선택</div>;
  }
  if (q.question_type === "rating") {
    return (
      <div className="flex gap-1">
        {Array.from({ length: q.rating_max }, (_, i) => (
          <span
            key={i}
            className="w-7 h-7 border border-border-default rounded text-caption flex items-center justify-center bg-bg-secondary text-text-tertiary"
          >
            {i + 1}
          </span>
        ))}
      </div>
    );
  }
  if (q.question_type === "single_choice" || q.question_type === "multi_choice") {
    return (
      <div className="space-y-1">
        {q.options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2 text-caption">
            <span
              className={`w-3 h-3 border border-border-default ${
                q.question_type === "single_choice" ? "rounded-full" : "rounded-sm"
              }`}
            />
            <span>{opt}</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
}
