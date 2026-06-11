"use client";

/**
 * AdminSidebar의 collapsed 상태를 layout과 공유.
 * - localStorage 'sidebar.collapsed'로 페이지 새로고침 후에도 유지.
 * - layout.tsx의 main 영역 margin이 collapsed에 반응하도록 사용.
 */

import { createContext, useCallback, useContext, useEffect, useState } from "react";

interface SidebarContextValue {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  toggle: () => void;
  /** localStorage에 저장하지 않는 일시 접힘 — 도구 집중 모드용.
   *  (도구 페이지 진입 시 접고, 나가면 사용자의 원래 설정으로 복원) */
  setCollapsedTransient: (v: boolean) => void;
  // 모바일 드로어 열림 상태 (작은 화면에서 사이드바를 오버레이로 표시)
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
}

const SidebarContext = createContext<SidebarContextValue>({
  collapsed: false,
  setCollapsed: () => {},
  toggle: () => {},
  setCollapsedTransient: () => {},
  mobileOpen: false,
  setMobileOpen: () => {},
});

export const useSidebar = () => useContext(SidebarContext);

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsedState] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const stored = typeof window !== "undefined"
      ? localStorage.getItem("sidebar.collapsed")
      : null;
    if (stored === "true") setCollapsedState(true);
  }, []);

  const setCollapsed = useCallback((v: boolean) => {
    setCollapsedState(v);
    if (typeof window !== "undefined") {
      localStorage.setItem("sidebar.collapsed", String(v));
    }
  }, []);

  const toggle = useCallback(() => {
    setCollapsedState((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        localStorage.setItem("sidebar.collapsed", String(next));
      }
      return next;
    });
  }, []);

  const setCollapsedTransient = useCallback((v: boolean) => {
    setCollapsedState(v);
  }, []);

  return (
    <SidebarContext.Provider
      value={{ collapsed, setCollapsed, toggle, setCollapsedTransient, mobileOpen, setMobileOpen }}
    >
      {children}
    </SidebarContext.Provider>
  );
}
