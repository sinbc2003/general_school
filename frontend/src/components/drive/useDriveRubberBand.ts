"use client";

/**
 * 빈영역 드래그로 박스 그어서 다중 선택 (Windows 탐색기 식 "고무줄 선택").
 *
 * 동작:
 *  - 빈 영역 onMouseDown으로 startRubberBand 호출
 *  - 3px 이상 드래그하면 박스 시작 (단순 클릭과 구분)
 *  - 박스가 지나는 모든 data-drive-key 카드/행 선택
 *  - Ctrl/Shift 누른 상태로 시작하면 기존 선택에 추가
 *
 * 반환:
 *  - dragBox: 박스 좌표 (DrivePage가 fixed overlay로 렌더)
 *  - startRubberBand: 빈 영역 onMouseDown에 바인딩
 */

import { useEffect, useRef, useState } from "react";

interface BoxRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function intersects(a: DOMRect, box: BoxRect): boolean {
  const bx1 = Math.min(box.x1, box.x2);
  const by1 = Math.min(box.y1, box.y2);
  const bx2 = Math.max(box.x1, box.x2);
  const by2 = Math.max(box.y1, box.y2);
  return !(a.right < bx1 || a.left > bx2 || a.bottom < by1 || a.top > by2);
}

interface Params {
  selected: Set<string>;
  setSelected: (s: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
}

export function useDriveRubberBand({ selected, setSelected }: Params) {
  const [dragBox, setDragBox] = useState<BoxRect | null>(null);
  const dragStartRef = useRef<{
    x: number; y: number; base: Set<string>; additive: boolean; started: boolean;
  } | null>(null);

  const startRubberBand = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // 좌클릭만
    const target = e.target as HTMLElement;
    if (target.closest("[data-drive-card]") || target.closest("[data-drive-row]")) return;
    if (target.closest("button, a, input, select, textarea")) return;
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    if (!additive) setSelected(new Set()); // 빈영역 클릭만으로도 해제
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      base: additive ? new Set(selected) : new Set(),
      additive,
      started: false,
    };
  };

  // 마우스 move/up 글로벌 리스너 — mount 시 한 번만 등록 (stale closure 회피).
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const s = dragStartRef.current;
      if (!s) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      // 첫 3px 이하면 박스 시작 안 함 (단순 클릭과 구분)
      if (!s.started) {
        if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
        s.started = true;
      }
      const box: BoxRect = { x1: s.x, y1: s.y, x2: e.clientX, y2: e.clientY };
      setDragBox(box);
      const nodes = document.querySelectorAll<HTMLElement>("[data-drive-key]");
      const hit = new Set(s.base);
      nodes.forEach((n) => {
        const key = n.dataset.driveKey;
        if (!key) return;
        if (intersects(n.getBoundingClientRect(), box)) hit.add(key);
        else if (!s.additive) hit.delete(key);
      });
      setSelected(hit);
    };
    const onUp = () => {
      if (dragStartRef.current) {
        dragStartRef.current = null;
        setDragBox(null);
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { dragBox, startRubberBand };
}
