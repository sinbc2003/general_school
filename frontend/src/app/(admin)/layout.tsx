"use client";

import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AdminSidebar } from "@/components/admin/sidebar";
import { FeedbackPanel } from "@/components/feedback-panel";
import { SidebarProvider, useSidebar } from "@/lib/sidebar-context";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <AdminLayoutInner>{children}</AdminLayoutInner>
    </SidebarProvider>
  );
}

function AdminLayoutInner({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { collapsed } = useSidebar();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (user?.role === "student") {
      router.push("/s/dashboard");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-text-secondary">로딩 중...</div>
      </div>
    );
  }

  if (!user) return null;
  if (user.role === "student") return null;

  return (
    <div className="min-h-screen bg-bg-secondary">
      <AdminSidebar />
      <main
        className={`p-6 transition-[margin] duration-200 ${
          collapsed ? "ml-sidebar-collapsed" : "ml-sidebar"
        }`}
      >
        {children}
      </main>
      <FeedbackPanel />
    </div>
  );
}
