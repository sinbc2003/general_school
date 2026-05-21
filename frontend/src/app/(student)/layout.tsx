"use client";

/**
 * 학생 영역 layout — admin layout과 동일한 AdminSidebar 사용 (UI 통합).
 *
 * 정책: 학생/교사/관리자 모두 같은 사이드바를 본다.
 *   - 메뉴 가시성은 role/permission으로 자동 필터링.
 *   - /s/* 경로는 그대로 유지 (학생 전용 페이지지만 사이드바는 통합).
 *   - 교사/관리자도 /s/* 페이지 접근 가능 (학생 화면 보기).
 */

import { useAuth } from "@/lib/auth-context";
import { AdminSidebar } from "@/components/admin/sidebar";
import { FeedbackPanel } from "@/components/feedback-panel";
import { SidebarProvider, useSidebar } from "@/lib/sidebar-context";
import { AIAssistantProvider, useAIAssistant } from "@/lib/ai-assistant-context";

export default function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <AIAssistantProvider>
        <StudentLayoutInner>{children}</StudentLayoutInner>
      </AIAssistantProvider>
    </SidebarProvider>
  );
}

function StudentLayoutInner({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { collapsed } = useSidebar();
  const ai = useAIAssistant();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-text-secondary">로딩 중...</div>
      </div>
    );
  }
  if (!user) return null;

  return (
    <div className="min-h-screen bg-bg-secondary">
      <AdminSidebar />
      <main
        className={`p-6 transition-[margin,padding] duration-200 ${
          collapsed ? "ml-sidebar-collapsed" : "ml-sidebar"
        }`}
        style={ai.open ? { paddingRight: ai.panelWidth + 8 } : undefined}
      >
        {children}
      </main>
      <FeedbackPanel />
    </div>
  );
}
