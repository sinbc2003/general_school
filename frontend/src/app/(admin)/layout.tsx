"use client";

import { useEffect, useState } from "react";
import { Menu } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { AdminSidebar } from "@/components/admin/sidebar";
import { FeedbackPanel } from "@/components/feedback-panel";
import Email2FAModal from "@/components/Email2FAModal";
import { SidebarProvider, useSidebar } from "@/lib/sidebar-context";
import { useBranding } from "@/lib/branding-context";
import { AIAssistantProvider, useAIAssistant } from "@/lib/ai-assistant-context";
import { isToolWindow } from "@/lib/open-tool-window";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <AIAssistantProvider>
        <AdminLayoutInner>{children}</AdminLayoutInner>
      </AIAssistantProvider>
    </SidebarProvider>
  );
}

function AdminLayoutInner({ children }: { children: React.ReactNode }) {
  // 통합 UI: 학생/교사/관리자 모두 같은 사이드바 사용.
  const { user, loading } = useAuth();
  const { collapsed, mobileOpen, setMobileOpen } = useSidebar();
  const { schoolName } = useBranding();
  const ai = useAIAssistant();

  // 도구 "새 창"(window.name=gs-embed-*) — 사이드바 없이 꽉 찬 화면.
  // window.name은 창 내 이동에도 유지 → 새창 안에서는 계속 풀스크린.
  // (hydration mismatch 회피 위해 mount 후 판정 — 첫 페인트 직후 사이드바 제거)
  const [embedded, setEmbedded] = useState(false);
  useEffect(() => {
    if (isToolWindow()) setEmbedded(true);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-text-secondary">로딩 중...</div>
      </div>
    );
  }

  if (!user) return null;

  if (embedded) {
    return (
      <div className="min-h-screen bg-bg-secondary">
        <main className="p-3 md:p-4">{children}</main>
        <Email2FAModal />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-secondary">
      <AdminSidebar />

      {/* 모바일: 드로어 열렸을 때 배경 (탭하면 닫힘) */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/40 z-30"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <div className={`transition-[margin] duration-200 ${collapsed ? "md:ml-sidebar-collapsed" : "md:ml-sidebar"}`}>
        {/* 모바일 상단바 — 햄버거로 메뉴 열기 */}
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
      <Email2FAModal />
    </div>
  );
}
