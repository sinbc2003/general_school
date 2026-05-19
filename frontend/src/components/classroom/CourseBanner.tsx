"use client";

/**
 * 강좌 상세 헤더 배너 — Google Classroom 식 큰 컬러 배너.
 *
 * - 좌측 위쪽: 강좌명 + 클래스명/과목/담당
 * - 좌측 아래쪽: 설명 (옵션)
 * - 우측 상단: 액션 칩들 (협업 문서 / 설문지 등) — admin/teacher만
 */

import Link from "next/link";
import { ArrowLeft, Archive, FileText, ClipboardList, Presentation } from "lucide-react";
import type { CourseTone } from "./_color";

interface CourseBannerProps {
  cid: number;
  name: string;
  subject: string;
  className: string | null;
  teacherName?: string;
  description: string | null;
  isActive: boolean;
  studentCount: number;
  viewerRole: "admin" | "teacher" | "student";
  tone: CourseTone;
  /** 학생 페이지면 /s/classroom, admin이면 /classroom */
  baseHref?: string;
}

export function CourseBanner({
  cid, name, subject, className, teacherName, description, isActive,
  studentCount, viewerRole, tone, baseHref = "/classroom",
}: CourseBannerProps) {
  const isStaff = viewerRole === "admin" || viewerRole === "teacher";

  return (
    <div
      className="rounded-xl shadow-sm mb-4 overflow-hidden relative"
      style={{ backgroundColor: tone.bg, color: tone.fg }}
    >
      {/* 좌상단: 목록으로 */}
      <Link
        href={baseHref}
        className="absolute top-3 left-3 inline-flex items-center gap-1 text-[12px] opacity-80 hover:opacity-100"
      >
        <ArrowLeft size={12} /> 클래스룸
      </Link>

      {/* 우상단: 액션 칩들 */}
      <div className="absolute top-3 right-3 flex items-center gap-1.5">
        <Link
          href={`${baseHref}/${cid}/docs`}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11.5px] rounded bg-white/20 hover:bg-white/30 backdrop-blur-sm"
          title="협업 문서"
        >
          <FileText size={11} /> 협업 문서
        </Link>
        <Link
          href={`${baseHref}/${cid}/decks`}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11.5px] rounded bg-white/20 hover:bg-white/30 backdrop-blur-sm"
          title="프리젠테이션"
        >
          <Presentation size={11} /> 프리젠테이션
        </Link>
        <Link
          href={`${baseHref}/${cid}/surveys`}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11.5px] rounded bg-white/20 hover:bg-white/30 backdrop-blur-sm"
          title="설문지"
        >
          <ClipboardList size={11} /> 설문지
        </Link>
      </div>

      {/* 메인 콘텐츠 */}
      <div className="px-6 pt-14 pb-5 min-h-[140px]">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-[26px] font-bold leading-tight">{name}</h1>
          {!isActive && (
            <span className="text-[11px] px-2 py-0.5 bg-white/25 rounded inline-flex items-center gap-1 font-normal">
              <Archive size={10} /> 보관
            </span>
          )}
        </div>
        <div className="text-[13px] opacity-90 mt-1.5">
          {subject}
          {className && <span> · {className}</span>}
          {teacherName && isStaff && <span> · 담당 {teacherName}</span>}
          <span> · 수강생 {studentCount}명</span>
        </div>
        {description && (
          <p className="text-[13px] opacity-90 mt-3 max-w-3xl whitespace-pre-wrap line-clamp-3">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}
