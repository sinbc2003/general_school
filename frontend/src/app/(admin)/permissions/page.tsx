"use client";

/**
 * 권한 관리 페이지 — 탭 라우팅 + 각 탭 컴포넌트 호출.
 *
 * 각 탭은 _tabs/ 하위 별도 파일로 분리되어 있음:
 * - PermissionMatrixTab: 역할별 권한 매트릭스 + 정책 토글
 * - PositionTemplatesTab: 학기·직책 기반 권한 위임
 * - UserInspectTab: 사용자별 권한 검사 + 활성 세션 + 강제 로그아웃
 * - PermissionAuditHistoryTab: 권한 변경 이력 timeline
 * - DesignatedAdminsTab: 지정관리자 목록 + 유효 권한 요약
 * - PermissionGroupsTab: 권한 그룹 CRUD + 멤버 관리
 *
 * 공통 타입은 _tabs/types.ts.
 */

import { useState } from "react";
import { Shield, Users, Layers, Briefcase, Eye, History } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { PermissionMatrixTab } from "./_tabs/PermissionMatrixTab";
import { PositionTemplatesTab } from "./_tabs/PositionTemplatesTab";
import { UserInspectTab } from "./_tabs/UserInspectTab";
import { PermissionAuditHistoryTab } from "./_tabs/PermissionAuditHistoryTab";
import { DesignatedAdminsTab } from "./_tabs/DesignatedAdminsTab";
import { PermissionGroupsTab } from "./_tabs/PermissionGroupsTab";


type Tab = "matrix" | "positions" | "inspect" | "history" | "admins" | "groups";

interface TabConfig {
  key: Tab;
  label: string;
  icon: LucideIcon;
  Component: React.ComponentType;
}

const TABS: TabConfig[] = [
  { key: "matrix", label: "역할별 기본값", icon: Shield, Component: PermissionMatrixTab },
  { key: "positions", label: "직책 권한 (학기)", icon: Briefcase, Component: PositionTemplatesTab },
  { key: "inspect", label: "사용자 권한 검사", icon: Eye, Component: UserInspectTab },
  { key: "history", label: "변경 이력", icon: History, Component: PermissionAuditHistoryTab },
  { key: "admins", label: "지정관리자", icon: Users, Component: DesignatedAdminsTab },
  { key: "groups", label: "권한 그룹", icon: Layers, Component: PermissionGroupsTab },
];

export default function PermissionsPage() {
  const [tab, setTab] = useState<Tab>("matrix");
  const ActiveTab = TABS.find((t) => t.key === tab)?.Component;

  return (
    <div>
      <h1 className="text-title text-text-primary mb-6">권한 관리</h1>

      <div className="flex gap-1 mb-6 bg-bg-secondary rounded-lg p-1 w-fit flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-body rounded transition-colors ${
              tab === t.key
                ? "bg-bg-primary text-accent font-medium shadow-sm"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            <t.icon size={16} />
            {t.label}
          </button>
        ))}
      </div>

      {ActiveTab && <ActiveTab />}
    </div>
  );
}
