"use client";

/**
 * 드라이브 검색 input + 최근 검색 히스토리 dropdown.
 *
 * - localStorage `drive.search.history` (useSearchHistory hook 사용)
 * - focus 시 dropdown 열기, blur 시 150ms 지연 후 닫기 (항목 클릭 보존)
 * - 항목 클릭 → 검색어 설정, X 클릭 → 개별 삭제, "전체 삭제" → 비우기
 */

import { useState } from "react";
import { Search, X } from "lucide-react";

interface SearchHistory {
  history: string[];
  remove: (q: string) => void;
  clear: () => void;
}

interface DriveSearchBarProps {
  value: string;
  onChange: (v: string) => void;
  history: SearchHistory;
  placeholder?: string;
}

export function DriveSearchBar({
  value,
  onChange,
  history,
  placeholder = "제목·본문·폴더 검색 (2자 이상)...",
}: DriveSearchBarProps) {
  const [showHistory, setShowHistory] = useState(false);

  return (
    <div className="relative flex-1 max-w-md">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setShowHistory(true)}
        onBlur={() => setTimeout(() => setShowHistory(false), 150)}
        className="w-full pl-9 pr-9 py-2 text-[13px] border border-border-default rounded-md bg-bg-primary text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary"
        >
          <X size={14} />
        </button>
      )}
      {/* 검색 히스토리 dropdown */}
      {showHistory && !value && history.history.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-bg-primary border border-border-default rounded-md shadow-lg py-1 max-h-64 overflow-y-auto">
          <div className="px-3 py-1 text-[10px] text-text-tertiary uppercase tracking-wide flex items-center justify-between">
            <span>최근 검색</span>
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); history.clear(); }}
              className="text-text-tertiary hover:text-text-primary text-[10px]"
            >
              전체 삭제
            </button>
          </div>
          {history.history.map((q) => (
            <button
              key={q}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(q);
                setShowHistory(false);
              }}
              className="w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-bg-secondary flex items-center justify-between group"
            >
              <span className="text-text-primary inline-flex items-center gap-1.5">
                <Search size={11} className="text-text-tertiary" /> {q}
              </span>
              <span
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); history.remove(q); }}
                className="opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-status-error p-0.5"
              >
                <X size={11} />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
