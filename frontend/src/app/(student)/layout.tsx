"use client";

/**
 * 학생 영역 layout — admin layout과 동일한 AdminSidebar 사용 (UI 통합).
 *
 * 정책: 학생/교사/관리자 모두 같은 사이드바를 본다.
 *   - 메뉴 가시성은 role/permission으로 자동 필터링.
 *   - /s/* 경로는 그대로 유지 (학생 전용 페이지지만 사이드바는 통합).
 *   - 교사/관리자도 /s/* 페이지 접근 가능 (학생 화면 보기).
 */

import { Menu } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { AdminSidebar } from "@/components/admin/sidebar";
import { FeedbackPanel } from "@/components/feedback-panel";
import { SidebarProvider, useSidebar } from "@/lib/sidebar-context";
import { useBranding } from "@/lib/branding-context";
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
  const { collapsed, mobileOpen, setMobileOpen } = useSidebar();
  const { schoolName } = useBranding();
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

      {/* 모바일: 드로어 배경 (탭하면 닫힘) */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/40 z-30"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <div className={`transition-[margin] duration-200 ${collapsed ? "md:ml-sidebar-collapsed" : "md:ml-sidebar"}`}>
        {/* 모바일 상단바 */}
        <header className="md:hidden sticky top-0 z-20 flex items-center gap-3 h-14 px-4 bg-bg-primary border-b border-border-default">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="메뉴 열기"
            className="p-1 -ml-1 hover:bg-bg-secondary rounded"
          >
            <Menu size={22} />
          </button>
          <span className="font-semibold text-text-primary truncate">{schoolName}</span>
        </header>

        <main
          className="p-4 md:p-6 transition-[padding] duration-200"
          style={ai.open ? { paddingRight: ai.panelWidth + 8 } : undefined}
        >
          {children}
        </main>
      </div>

      <FeedbackPanel />
    </div>
  );
}
