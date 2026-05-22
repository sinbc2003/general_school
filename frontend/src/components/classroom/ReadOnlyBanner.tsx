"use client";

/**
 * 이전 학기 강좌 read-only 배너 — Google Classroom 식 "보관" 상태.
 *
 * admin + student 페이지 양쪽 공유. is_past_semester=true일 때 표시.
 * - admin: 글·과제 작성 안내 ("새 글·과제는 현재 학기 강좌에서 작성하세요")
 * - student: 열람 안내 ("읽기 전용으로 열람 중")
 */

interface SemesterInfo {
  year: number;
  term: number;
}

interface Props {
  semester?: SemesterInfo | null;
  variant?: "admin" | "student";
}

export function ReadOnlyBanner({ semester, variant = "admin" }: Props) {
  return (
    <div className="mb-3 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2 text-caption text-amber-900">
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-200 rounded text-[11px] font-medium">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" />
        </svg>
        보관
      </span>
      <span>
        <b>이전 학기</b>
        {semester ? ` (${semester.year}학년도 ${semester.term}학기)` : ""} 강좌입니다 —{" "}
        {variant === "student"
          ? "읽기 전용으로 열람 중."
          : "읽기 전용. 새 글·과제는 현재 학기 강좌에서 작성하세요."}
      </span>
    </div>
  );
}
