"use client";

/**
 * 클래스룸 홈 강좌 카드 — Google Classroom 식.
 *
 * 구성:
 *   ┌──────────────────────────────┐
 *   │ ▓▓▓▓ (컬러 배너, 강좌명)      │
 *   │                              │
 *   │            [원형 일러스트]    │  ← 우하단
 *   ├──────────────────────────────┤
 *   │ [👥 N명] [Archive 표시]       │
 *   │ 담당 교사 (admin만)            │
 *   └──────────────────────────────┘
 */

import Link from "next/link";
import { Users, Archive, BookOpen } from "lucide-react";
import { getCourseTone } from "./_color";

interface CourseCardProps {
  id: number;
  name: string;
  subject: string;
  class_name: string | null;
  teacher_name?: string;
  is_active: boolean;
  student_count: number;
  /** "/classroom" (admin) 또는 "/s/classroom" (student) */
  baseHref?: string;
  /** admin이면 담당 교사명 표시 */
  showTeacher?: boolean;
}

export function CourseCard({
  id, name, subject, class_name, teacher_name, is_active,
  student_count, baseHref = "/classroom", showTeacher = false,
}: CourseCardProps) {
  const tone = getCourseTone(id);

  return (
    <Link
      href={`${baseHref}/${id}`}
      className={`block bg-bg-primary border border-border-default rounded-xl overflow-hidden hover:shadow-md transition-shadow ${
        !is_active ? "opacity-70" : ""
      }`}
    >
      {/* 컬러 배너 — 강좌명 / 부제 */}
      <div
        className="relative p-4 pb-5 min-h-[110px]"
        style={{ backgroundColor: tone.bg, color: tone.fg }}
      >
        <div className="text-[18px] font-bold leading-tight pr-12 line-clamp-2">
          {name}
        </div>
        <div className="text-[12px] opacity-90 mt-1 line-clamp-1">
          {subject}{class_name && ` · ${class_name}`}
        </div>
        {showTeacher && teacher_name && (
          <div className="text-[11px] opacity-80 mt-3 line-clamp-1">
            {teacher_name}
          </div>
        )}

        {/* 우하단 원형 일러스트 (책 아이콘) */}
        <div
          className="absolute right-3 bottom-3 w-9 h-9 rounded-full flex items-center justify-center"
          style={{ backgroundColor: "rgba(255,255,255,0.25)" }}
        >
          <BookOpen size={18} />
        </div>
      </div>

      {/* 본문 — 학생 수 + archived 배지 */}
      <div className="px-4 py-2.5 flex items-center gap-2 text-caption text-text-tertiary">
        <span className="inline-flex items-center gap-1">
          <Users size={12} /> {student_count}명
        </span>
        {!is_active && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[10px] rounded">
            <Archive size={10} /> 보관
          </span>
        )}
      </div>
    </Link>
  );
}
