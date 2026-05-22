"use client";

/**
 * 드라이브 backend 검색 hook.
 *
 * 사용자가 검색어 입력 → 400ms debounce → /api/drive/search 호출 →
 * results(자료) + folders + total 반환. 비어있는 query면 enable 안 함.
 *
 * 2자 이상부터 검색 시작 (한 글자 입력은 너무 많은 결과).
 */

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/client";
import type { ItemType } from "./_drive-shared";

export interface SearchResultItem {
  type: ItemType;
  id: number;
  title: string;
  folder_id: number | null;
  course_id: number | null;
  updated_at: string | null;
  match_field: "title" | "body" | "description" | "question" | "slide_body";
  snippet: string | null;
}

export interface SearchResultFolder {
  id: number;
  name: string;
  parent_id: number | null;
  sort_order: number;
  is_system_locked: boolean;
}

interface SearchResults {
  query: string;
  total: number;
  items: SearchResultItem[];
  folders: SearchResultFolder[];
}

const MIN_LENGTH = 2;
const DEBOUNCE_MS = 400;

export function useDriveSearch(query: string, trashMode: boolean) {
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const trimmed = query.trim();
  const active = trimmed.length >= MIN_LENGTH;

  // snippet/matchField 매핑 ({type}:{id} → {snippet, matchField})
  const matchMap: Map<string, { snippet: string | null; matchField: string }> = new Map();
  if (active && results) {
    for (const r of results.items) {
      matchMap.set(`${r.type}:${r.id}`, {
        snippet: r.snippet,
        matchField: r.match_field,
      });
    }
  }

  useEffect(() => {
    if (!active) {
      setResults(null);
      setLoading(false);
      abortRef.current?.abort();
      return;
    }

    const handle = window.setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      try {
        const params = new URLSearchParams({
          q: trimmed,
          type: "all",
          include_folders: "true",
          include_trash: trashMode ? "true" : "false",
        });
        const r = await api.get<SearchResults>(
          `/api/drive/search?${params.toString()}`,
          { signal: ctrl.signal as any },
        );
        if (!ctrl.signal.aborted) setResults(r);
      } catch (e: any) {
        if (e?.name !== "AbortError") setResults(null);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(handle);
    };
  }, [trimmed, active, trashMode]);

  return { active, results, loading, matchMap };
}
