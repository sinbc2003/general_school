"use client";

/**
 * 드라이브 검색 히스토리 — localStorage 기반.
 *
 * - 최근 N개 (default 10) 보관
 * - 중복 제거 (있으면 맨 위로)
 * - 사용자 명시 삭제 가능
 */

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "drive.search.history";
const MAX = 10;

function load(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((s) => typeof s === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
}

function save(list: string[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {}
}

export function useSearchHistory() {
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    setHistory(load());
  }, []);

  const record = useCallback((query: string) => {
    const q = query.trim();
    if (!q || q.length < 2) return;
    setHistory((prev) => {
      const next = [q, ...prev.filter((x) => x !== q)].slice(0, MAX);
      save(next);
      return next;
    });
  }, []);

  const remove = useCallback((query: string) => {
    setHistory((prev) => {
      const next = prev.filter((x) => x !== query);
      save(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setHistory([]);
    save([]);
  }, []);

  return { history, record, remove, clear };
}
