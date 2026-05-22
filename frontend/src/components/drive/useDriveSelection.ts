"use client";

/**
 * DrivePage 다중 선택 + 클릭/더블클릭/우클릭 핸들러 hook.
 *
 * Google Drive 식 동작:
 *   - 클릭 = 단일 선택 (열기는 더블클릭)
 *   - Ctrl/Cmd+클릭 = 토글
 *   - Shift+클릭 = lastKey~current 범위 선택
 *   - 더블클릭 = 편집 페이지 이동 (휴지통 모드면 skip)
 *   - 우클릭 = 미선택 항목이면 단일 선택 + ctx menu, 빈영역이면 ctx menu만
 *
 * F2/Enter — 단일 선택 시 이름 바꾸기 시작 (외부 startRename callback).
 *
 * filtered는 외부에서 주입 (useMemo 결과). lastKey는 hook이 보관.
 */

import { useEffect, useState } from "react";
import type { DriveItem } from "./_drive-shared";
import { itemKey } from "./_drive-shared";

interface Ctx { x: number; y: number; target: DriveItem | null }

interface Params {
  filtered: DriveItem[];
  items: DriveItem[];
  trashMode: boolean;
  renamingKey: string | null;
  hrefFor: (it: DriveItem) => string;
  navigate: (href: string) => void;
  startRename: (it: DriveItem) => void;
  setCtx: (c: Ctx | null) => void;
}

export function useDriveSelection(p: Params) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastKey, setLastKey] = useState<string | null>(null);

  const handleItemClick = (it: DriveItem, e: React.MouseEvent) => {
    const key = itemKey(it);
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      setLastKey(key);
      return;
    }
    if (e.shiftKey && lastKey) {
      e.preventDefault();
      const start = p.filtered.findIndex((x) => itemKey(x) === lastKey);
      const end = p.filtered.findIndex((x) => itemKey(x) === key);
      if (start >= 0 && end >= 0) {
        const [a, b] = start < end ? [start, end] : [end, start];
        setSelected((prev) => {
          const next = new Set(prev);
          for (let i = a; i <= b; i++) next.add(itemKey(p.filtered[i]));
          return next;
        });
      }
      return;
    }
    // 일반 클릭 — 단일 선택 (열기는 더블 클릭)
    e.preventDefault();
    setSelected(new Set([key]));
    setLastKey(key);
  };

  const handleItemDoubleClick = (it: DriveItem, e: React.MouseEvent) => {
    if (p.trashMode) return; // 휴지통에선 더블클릭으로 안 열림
    e.preventDefault();
    p.navigate(p.hrefFor(it));
  };

  const handleItemContextMenu = (it: DriveItem | null, e: React.MouseEvent) => {
    e.preventDefault();
    if (it) {
      const key = itemKey(it);
      if (!selected.has(key)) {
        // 선택 안 된 항목 우클릭 → 그 항목 단일 선택
        setSelected(new Set([key]));
        setLastKey(key);
      }
    } else {
      // 빈 영역 우클릭 → 선택 해제 + "새로 만들기" 메뉴
      setSelected(new Set());
    }
    p.setCtx({ x: e.clientX, y: e.clientY, target: it });
  };

  // F2 / Enter 단축키 — 단일 선택 시 이름 바꾸기 시작
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      if ((e.key === "F2" || e.key === "Enter") && selected.size === 1 && !p.renamingKey) {
        const onlyKey = Array.from(selected)[0];
        const it = p.items.find((x) => itemKey(x) === onlyKey);
        if (it && !p.trashMode) {
          e.preventDefault();
          p.startRename(it);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, p.items, p.trashMode, p.renamingKey]);

  return {
    selected, setSelected,
    lastKey, setLastKey,
    handleItemClick,
    handleItemDoubleClick,
    handleItemContextMenu,
  };
}
