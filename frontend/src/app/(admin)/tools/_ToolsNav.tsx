"use client";

/** 수업 도구 / 업무 도구 세그먼트 네비 (도구 허브 상단 공용). */

import Link from "next/link";
import { Wrench, Briefcase } from "lucide-react";

const TABS = [
  { key: "class", label: "수업 도구", href: "/tools", icon: Wrench },
  { key: "work", label: "업무 도구", href: "/tools/work", icon: Briefcase },
] as const;

export function ToolsNav({ active }: { active: "class" | "work" }) {
  return (
    <div className="mb-5 inline-flex rounded-lg border border-border-default bg-bg-secondary p-1">
      {TABS.map((t) => {
        const Icon = t.icon;
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-[13px] font-medium transition ${
              on
                ? "bg-bg-primary text-text-primary shadow-sm"
                : "text-text-tertiary hover:text-text-primary"
            }`}
          >
            <Icon size={14} />
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
