"use client";

/**
 * 도구(문서/시트/덱/설문/HWP) detail 페이지에서 좌측 사이드바 자동 접힘.
 *
 * - mount 시 currently collapsed 아니면 setCollapsed(true)
 * - unmount 시 원래 펼쳐있던 상태였으면 복원
 * - 사용자가 페이지 안에서 펼치면 그 변경은 unmount 복원이 덮어쓰지 않음
 *   (mount 시점 상태만 기억)
 *
 * 사용: 도구 detail 페이지 함수 안에서 `useAutoCollapseSidebar()` 한 줄 호출.
 */

import { useEffect, useRef } from "react";
import { useSidebar } from "@/lib/sidebar-context";

export function useAutoCollapseSidebar() {
  const { collapsed, setCollapsed } = useSidebar();
  const wasExpandedRef = useRef(false);

  useEffect(() => {
    wasExpandedRef.current = !collapsed;
    if (!collapsed) setCollapsed(true);
    return () => {
      if (wasExpandedRef.current) setCollapsed(false);
    };
    // mount/unmount만 실행. collapsed 변동은 사용자 의도라 추적 안 함.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
