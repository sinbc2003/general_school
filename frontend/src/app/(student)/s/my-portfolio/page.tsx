"use client";

/**
 * 학생 본인 포트폴리오 — 4탭 통합 페이지.
 *
 * 탭별 구현은 _components/ 디렉토리, 공통 타입·StatCard·EmptyState는 _shared.tsx.
 */

import { useState } from "react";
import { ClipboardList, LayoutGrid, ListChecks, Users2 } from "lucide-react";
import { TimelineTab } from "./_components/TimelineTab";
import { ArtifactsTab } from "./_components/ArtifactsTab";
import { AssignmentsTab } from "./_components/AssignmentsTab";
import { ClubsTab } from "./_components/ClubsTab";


type Tab = "timeline" | "artifacts" | "assignments" | "clubs";

const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: "timeline", label: "전체 (timeline)", icon: ListChecks },
  { key: "artifacts", label: "자유 산출물", icon: LayoutGrid },
  { key: "assignments", label: "과제 제출물", icon: ClipboardList },
  { key: "clubs", label: "동아리 산출물", icon: Users2 },
];

export default function MyPortfolioPage() {
  const [tab, setTab] = useState<Tab>("timeline");

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-title text-text-primary">나의 포트폴리오</h1>
        <p className="text-caption text-text-tertiary mt-0.5">
          자유 업로드 산출물 · 과제 제출물 · 동아리 산출물을 한 곳에서 관리하세요.
        </p>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 mb-5 bg-bg-secondary rounded-lg p-1 w-fit flex-wrap">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-body rounded transition-colors ${
              tab === key
                ? "bg-bg-primary text-accent font-medium shadow-sm"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === "timeline" && <TimelineTab />}
      {tab === "artifacts" && <ArtifactsTab />}
      {tab === "assignments" && <AssignmentsTab />}
      {tab === "clubs" && <ClubsTab />}
    </div>
  );
}
