"use client";

/**
 * 챗봇 전용 레이아웃 - claude.ai 풍 풀스크린.
 * 일반 admin/student 레이아웃의 사이드바/탭바를 거치지 않음.
 * 인증만 체크.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.push("/auth/login");
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#faf9f5] text-[#5a4a3a]">
        로딩 중...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#faf9f5] text-[#2c1810]">
      {children}
    </div>
  );
}
