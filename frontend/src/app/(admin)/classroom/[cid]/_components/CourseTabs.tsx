"use client";

/**
 * 강좌 상세 탭 네비게이션 — 게시판 / 수업 과제 / 사용자 / 성적.
 *
 * useState 기반 controlled 탭. parent에서 active 상태 관리.
 */

import { MessageSquare, ClipboardList, Users, BarChart3 } from "lucide-react";
import type { CourseTone } from "./_color";

export type CourseTab = "stream" | "coursework" | "people" | "grades";

interface CourseTabsProps {
  active: CourseTab;
  onChange: (tab: CourseTab) => void;
  tone: CourseTone;
}

const TABS: { id: CourseTab; label: string; icon: any }[] = [
  { id: "stream", label: "게시판", icon: MessageSquare },
  { id: "coursework", label: "수업 과제", icon: ClipboardList },
  { id: "people", label: "사용자", icon: Users },
  { id: "grades", label: "성적", icon: BarChart3 },
];

export function CourseTabs({ active, onChange, tone }: CourseTabsProps) {
  return (
    <div className="border-b border-border-default mb-4 flex items-center gap-1 overflow-x-auto">
      {TABS.map((t) => {
        const Icon = t.icon;
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-[13px] border-b-2 transition whitespace-nowrap ${
              isActive
                ? "border-b-2 font-semibold"
                : "border-transparent text-text-secondary hover:text-text-primary hover:bg-bg-secondary"
            }`}
            style={
              isActive
                ? { borderBottomColor: tone.accent, color: tone.accent }
                : undefined
            }
          >
            <Icon size={14} />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
