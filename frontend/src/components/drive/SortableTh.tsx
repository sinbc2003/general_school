"use client";

/**
 * 정렬 가능 컬럼 헤더 — DrivePage list view에서 사용.
 * 클릭으로 sort key 변경 + asc/desc 토글 표시.
 */

import { ArrowUp, ArrowDown } from "lucide-react";
import type { SortKey, SortDir } from "./_drive-shared";

export function SortableTh({
  sortKey,
  currentKey,
  dir,
  onClick,
  align,
  className,
  children,
}: {
  sortKey: SortKey;
  currentKey: SortKey;
  dir: SortDir;
  onClick: (k: SortKey) => void;
  align?: "left" | "right";
  className?: string;
  children: React.ReactNode;
}) {
  const isActive = sortKey === currentKey;
  return (
    <th className={`px-2 py-2 font-medium ${className || ""} ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-text-primary ${
          isActive ? "text-text-primary" : ""
        }`}
      >
        {children}
        {isActive && (dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </button>
    </th>
  );
}
