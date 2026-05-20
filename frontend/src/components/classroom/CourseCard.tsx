"use client";

/**
 * 클래스룸 홈 강좌 카드 — Google Classroom 식.
 *
 * 구성 (실제 Google과 비슷한 비율):
 *   ┌──────────────────────────────┐
 *   │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │  ← 컬러 배너 (강좌명 + 부제)
 *   │ 강좌명                       │
 *   │ 과목·반                       │
 *   │                              │
 *   ├──────────────────────────────┤
 *   │                              │  ← 흰 빈 영역 (스튜덴트 사진 자리)
 *   │                              │
 *   ├──────────────────────────────┤
 *   │ [📈] [📁]              [⋮]   │  ← 액션 아이콘 row
 *   └──────────────────────────────┘
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Users, Archive, TrendingUp, Folder, MoreVertical } from "lucide-react";
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
  const router = useRouter();

  return (
    <Link
      href={`${baseHref}/${id}`}
      className={`block bg-bg-primary border border-border-default rounded-xl overflow-hidden hover:shadow-md transition-shadow flex flex-col ${
        !is_active ? "opacity-70" : ""
      }`}
    >
      {/* 컬러 배너 — 강좌명 / 부제 (실제 Google 비율: 약 160px) */}
      <div
        className="relative px-5 pt-4 pb-5"
        style={{ backgroundColor: tone.bg, color: tone.fg, minHeight: "160px" }}
      >
        <div className="text-[22px] font-bold leading-tight pr-12 line-clamp-2">
          {name}
        </div>
        <div className="text-[13px] opacity-95 mt-1.5 line-clamp-1">
          {subject}{class_name && ` · ${class_name}`}
        </div>
        {showTeacher && teacher_name && (
          <div className="text-[12px] opacity-85 mt-2 line-clamp-1">
            {teacher_name}
          </div>
        )}
        {!is_active && (
          <span className="absolute top-3 right-3 text-[10px] px-2 py-0.5 bg-white/25 rounded inline-flex items-center gap-1">
            <Archive size={9} /> 보관
          </span>
        )}
      </div>

      {/* 흰 빈 영역 — 실제 Google은 학생 사진/일러스트. 우리는 여백만 */}
      <div className="flex-1 min-h-[60px]"></div>

      {/* 하단 액션 아이콘 row — 실제 Google 식 (작은 회색 아이콘들) */}
      <div className="px-3 py-2 flex items-center justify-between text-text-tertiary border-t border-border-default">
        <div className="flex items-center gap-1">
          <IconBtn
            title="진행 상황"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(`${baseHref}/${id}?tab=coursework`); }}
          >
            <TrendingUp size={16} />
          </IconBtn>
          <IconBtn
            title="강좌 폴더"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(`${baseHref}/${id}/docs`); }}
          >
            <Folder size={16} />
          </IconBtn>
        </div>
        <div className="flex items-center gap-3 text-[11.5px]">
          <span className="inline-flex items-center gap-1">
            <Users size={11} /> {student_count}
          </span>
          <IconBtn
            title="더보기"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
          >
            <MoreVertical size={15} />
          </IconBtn>
        </div>
      </div>
    </Link>
  );
}

function IconBtn({ children, title, onClick }: {
  children: React.ReactNode; title: string;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="w-8 h-8 rounded-full hover:bg-bg-secondary flex items-center justify-center transition"
    >
      {children}
    </button>
  );
}
