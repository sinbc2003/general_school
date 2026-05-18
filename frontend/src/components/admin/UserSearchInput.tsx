"use client";

/**
 * 사용자 검색 자동완성 입력.
 *
 * - 이름/이메일 typeahead 검색
 * - 선택 시 user_id를 상위에 전달
 * - 디바운스 200ms
 *
 * 학기 명단 추가 모달 같은 곳에서 user_id 직접 입력을 대체.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { api } from "@/lib/api/client";
import { Search, X, Check } from "lucide-react";

interface UserItem {
  id: number;
  name: string;
  email: string;
  role: string;
  status: string;
  grade: number | null;
  class_number: number | null;
  department: string | null;
}

interface Props {
  value: number | "";  // 선택된 user_id
  onSelect: (user: UserItem | null) => void;
  /** 검색 필터 — 'student' 또는 'teacher,staff' 형태. 미지정 시 전체. */
  roleFilter?: string;
  placeholder?: string;
  /** 이미 등록된 user_id (이 학기 enrollment에 있는 사용자 — 회색 표시) */
  excludeUserIds?: Set<number>;
  autoFocus?: boolean;
}

export function UserSearchInput({
  value, onSelect, roleFilter, placeholder, excludeUserIds, autoFocus,
}: Props) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<UserItem | null>(null);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<number | null>(null);

  // value가 외부에서 0/빈값으로 초기화되면 선택 해제
  useEffect(() => {
    if (!value && selected) {
      setSelected(null);
      setQuery("");
    }
  }, [value, selected]);

  // value(user_id)로 시작하면 그 사용자 정보 한 번 fetch (편집 진입 시)
  useEffect(() => {
    if (value && !selected) {
      api.get<{ items: UserItem[] }>(`/api/users?per_page=1&search=${value}`).catch(() => null);
      // simpler: try fetching the single user directly via id-based filter
      // 현재 백엔드 list_users는 id 필터 없으므로 search로는 안 됨. 일단 skip.
    }
  }, [value, selected]);

  const search = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("search", q);
      if (roleFilter) params.set("role", roleFilter);
      params.set("per_page", "30");
      const data = await api.get<{ items: UserItem[] }>(`/api/users?${params}`);
      setItems(data.items);
      setHighlightIdx(0);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [roleFilter]);

  // 디바운스 검색
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      search(query);
    }, 200);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query, open, search]);

  // 바깥 클릭 시 닫기
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const pick = (u: UserItem) => {
    if (excludeUserIds?.has(u.id)) return;
    setSelected(u);
    setQuery("");
    setOpen(false);
    onSelect(u);
  };

  const clear = () => {
    setSelected(null);
    setQuery("");
    onSelect(null);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const u = items[highlightIdx];
      if (u) pick(u);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      {selected ? (
        <div className="flex items-center gap-2 px-3 py-1.5 border border-border-default rounded bg-cream-100">
          <Check size={14} className="text-accent flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-body text-text-primary truncate">{selected.name}</div>
            <div className="text-caption text-text-tertiary truncate">
              {selected.email}
              {selected.role && ` · ${selected.role}`}
              {selected.grade && ` · ${selected.grade}-${selected.class_number}-${(selected as any).student_number ?? ""}`}
              {selected.department && ` · ${selected.department}`}
            </div>
          </div>
          <button
            onClick={clear}
            type="button"
            className="p-1 hover:bg-bg-primary rounded text-text-tertiary"
            title="선택 해제"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
          <input
            ref={inputRef}
            autoFocus={autoFocus}
            type="text"
            value={query}
            placeholder={placeholder || "이름 또는 이메일로 검색..."}
            onFocus={() => {
              setOpen(true);
              if (items.length === 0 && !loading) search("");
            }}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onKeyDown={onKeyDown}
            className="w-full pl-8 pr-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent"
          />
        </div>
      )}

      {open && !selected && (
        <div className="absolute z-20 mt-1 w-full bg-bg-primary border border-border-default rounded shadow-lg max-h-72 overflow-y-auto">
          {loading && items.length === 0 && (
            <div className="px-3 py-2 text-caption text-text-tertiary">검색 중...</div>
          )}
          {!loading && items.length === 0 && (
            <div className="px-3 py-3 text-caption text-text-tertiary text-center">
              {query ? "검색 결과 없음" : "이름 또는 이메일을 입력하세요"}
            </div>
          )}
          {items.map((u, i) => {
            const isExcluded = excludeUserIds?.has(u.id) || false;
            const isHighlighted = i === highlightIdx;
            return (
              <button
                key={u.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(u)}
                disabled={isExcluded}
                onMouseEnter={() => setHighlightIdx(i)}
                className={`w-full text-left px-3 py-2 border-t border-border-default first:border-t-0 ${
                  isHighlighted ? "bg-cream-100" : "bg-bg-primary"
                } ${isExcluded ? "opacity-40 cursor-not-allowed" : "hover:bg-bg-secondary cursor-pointer"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-body text-text-primary truncate">{u.name}</div>
                    <div className="text-caption text-text-tertiary truncate">
                      {u.email}
                      {u.grade && ` · ${u.grade}-${u.class_number}`}
                      {u.department && ` · ${u.department}`}
                    </div>
                  </div>
                  <span className="text-caption px-1.5 py-0.5 bg-bg-tertiary rounded text-text-secondary flex-shrink-0">
                    {u.role}
                  </span>
                  {isExcluded && (
                    <span className="text-caption text-text-tertiary flex-shrink-0">등록됨</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
