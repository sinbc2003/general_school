"use client";

/**
 * embed route group — admin/student layout(사이드바·헤더) 우회 fullscreen.
 * "새 창에서 열기" 클릭 시 사용. 인증은 root AuthProvider가 담당.
 */

import { useAuth } from "@/lib/auth-context";

export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center text-text-tertiary">
        로딩 중...
      </div>
    );
  }
  if (!user) {
    return (
      <div className="h-screen w-screen flex items-center justify-center text-text-tertiary">
        로그인이 필요합니다. <a href="/login" className="ml-2 text-accent underline">로그인 →</a>
      </div>
    );
  }
  return (
    <div className="h-screen w-screen overflow-hidden bg-bg-secondary">
      {children}
    </div>
  );
}
