"use client";

/**
 * DrivePage 이름 바꾸기 hook — F2/Enter 단축키 + commitRename.
 *
 * - renamingKey: 현재 편집 중인 itemKey (null = 비활성)
 * - renameDraft: input 임시 값
 * - startRename(it): 편집 시작
 * - commitRename(it): API call 후 자동 종료 + fetchAll
 * - cancelRename(): 편집 종료
 *
 * F2 / Enter — 단일 선택 시 자동 startRename (input/textarea focus 중이면 skip).
 *
 * 외부 의존: selected (단축키 발동 조건), items (lookup), trashMode, fetchAll.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import type { DriveItem, ItemType } from "./_drive-shared";
import { itemKey } from "./_drive-shared";

const RENAME_PATH: Partial<Record<ItemType, string>> = {
  docs: "/api/classroom/docs",
  sheets: "/api/classroom/sheets",
  decks: "/api/classroom/decks",
  surveys: "/api/classroom/surveys",
  hwps: "/api/classroom/hwps",
};

interface Params {
  selected: Set<string>;
  items: DriveItem[];
  trashMode: boolean;
  fetchAll: () => Promise<void> | void;
}

export function useDriveRename(p: Params) {
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const startRename = (it: DriveItem) => {
    setRenamingKey(itemKey(it));
    setRenameDraft(it.title);
  };

  const cancelRename = () => setRenamingKey(null);

  const commitRename = async (it: DriveItem) => {
    const next = renameDraft.trim();
    setRenamingKey(null);
    if (!next || next === it.title) return;
    const base = RENAME_PATH[it.type];
    if (!base) return;
    try {
      await api.put(`${base}/${it.id}`, { title: next });
      await p.fetchAll();
    } catch (e: any) {
      alert(e?.detail || "이름 바꾸기 실패");
    }
  };

  // F2 / Enter 단축키 — 단일 선택 시 이름 바꾸기 시작
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      if ((e.key === "F2" || e.key === "Enter") && p.selected.size === 1 && !renamingKey) {
        const onlyKey = Array.from(p.selected)[0];
        const it = p.items.find((x) => itemKey(x) === onlyKey);
        if (it && !p.trashMode) {
          e.preventDefault();
          startRename(it);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.selected, p.items, p.trashMode, renamingKey]);

  return {
    renamingKey, renameDraft, setRenameDraft,
    startRename, cancelRename, commitRename,
  };
}
