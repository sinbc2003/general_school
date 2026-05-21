"use client";

import { useAuth } from "@/lib/auth-context";
import { AdminSidebar } from "@/components/admin/sidebar";
import { FeedbackPanel } from "@/components/feedback-panel";
import { SidebarProvider, useSidebar } from "@/lib/sidebar-context";
import { AIAssistantProvider, useAIAssistant } from "@/lib/ai-assistant-context";

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
