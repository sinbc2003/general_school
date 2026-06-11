"use client";

/**
 * 도구 집중 모드 — 에듀테크 도구 실행 페이지에서 사이드바 자동 접힘.
 *
 * 진입 시 일시 접힘(localStorage 미저장), 떠날 때 사용자의 원래 설정 복원.
 * 사용자가 도구 안에서 직접 펼치면(toggle은 저장됨) 그 의사를 존중 — unmount
 * 복원도 localStorage 기준이라 일관됨.
 */

import { useEffect } from "react";
import { useSidebar } from "@/lib/sidebar-context";

export function useToolFocusMode() {
  const { setCollapsedTransient } = useSidebar();

  useEffect(() => {
    setCollapsedTransient(true);
    return () => {
      // 사용자의 저장된 설정으로 복원
      const stored = typeof window !== "undefined"
        && localStorage.getItem("sidebar.collapsed") === "true";
      setCollapsedTransient(stored);
    };
  }, [setCollapsedTransient]);
}
