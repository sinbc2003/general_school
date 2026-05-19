"use client";

/**
 * 강좌 상세 게시판 탭 좌측 위젯 — 강좌 정보 + 빠른 진입.
 *
 * Google Classroom의 좌측 "수업 코드 + 곧 마감되는 과제" 자리. 우리는 코드/마감
 * 데이터 모델 없으므로 단순 정보 + 진입 카드로 채움. 향후 코드 시스템·과제 마감
 * 추가 시 동일 자리 활용.
 */

import Link from "next/link";
import { Users, BookOpen, FileText, ClipboardList, ArrowRight } from "lucide-react";

interface CourseInfoWidgetProps {
  cid: number;
  subject: string;
  className: string | null;
  teacherName?: string;
  studentCount: number;
  /** /classroom or /s/classroom */
  baseHref?: string;
  showTeacher?: boolean;
}

export function CourseInfoWidget({
  cid, subject, className, teacherName, studentCount,
  baseHref = "/classroom", showTeacher = true,
}: CourseInfoWidgetProps) {
  return (
    <div className="space-y-3">
      {/* 강좌 정보 카드 */}
      <div className="bg-bg-primary border border-border-default rounded-lg p-4 space-y-2 text-caption">
        <div className="text-text-tertiary uppercase tracking-wide text-[10.5px] font-semibold mb-1">
          강좌 정보
        </div>
        <Row icon={BookOpen} label="과목" value={`${subject}${className ? " · " + className : ""}`} />
        {showTeacher && teacherName && (
          <Row icon={Users} label="담당" value={teacherName} />
        )}
        <Row icon={Users} label="수강생" value={`${studentCount}명`} />
      </div>

      {/* 빠른 진입 카드 */}
      <div className="bg-bg-primary border border-border-default rounded-lg overflow-hidden">
        <div className="px-4 py-2 border-b border-border-default text-[10.5px] font-semibold text-text-tertiary uppercase tracking-wide">
          빠른 진입
        </div>
        <QuickLink
          href={`${baseHref}/${cid}/docs`}
          icon={FileText}
          iconColor="#a16207"
          iconBg="#fef3c7"
          label="협업 문서"
          desc="실시간 동시 편집"
        />
        <QuickLink
          href={`${baseHref}/${cid}/surveys`}
          icon={ClipboardList}
          iconColor="#be185d"
          iconBg="#fce7f3"
          label="설문지"
          desc="응답 수집·QR 공유"
        />
      </div>
    </div>
  );
}

function Row({
  icon: Icon, label, value,
}: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon size={12} className="text-text-tertiary flex-shrink-0" />
      <span className="text-text-tertiary text-[11.5px]">{label}</span>
      <span className="text-text-primary flex-1 truncate">{value}</span>
    </div>
  );
}

function QuickLink({
  href, icon: Icon, iconColor, iconBg, label, desc,
}: {
  href: string; icon: any; iconColor: string; iconBg: string;
  label: string; desc: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg-secondary group transition"
    >
      <div
        className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: iconBg, color: iconColor }}
      >
        <Icon size={15} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-body font-medium text-text-primary truncate">{label}</div>
        <div className="text-[11px] text-text-tertiary truncate">{desc}</div>
      </div>
      <ArrowRight
        size={13}
        className="text-text-tertiary opacity-0 group-hover:opacity-100 transition flex-shrink-0"
      />
    </Link>
  );
}
