"use client";

/**
 * DrivePage 키보드 단축키 hook — Windows 식 ESC/Del/Ctrl+X/C/V/A.
 *
 * - ESC: 선택 해제 + ctx 닫음 + cut 해제
 * - Del/Backspace: 선택 항목 휴지통 (또는 영구 삭제)
 * - Ctrl+X/C: 잘라내기/복사 표시 (cutKeys + clipMode)
 * - Ctrl+V: 현재 폴더에 cut/copy 자료 일괄 적용 (move 또는 copy endpoint)
 * - Ctrl+A: 전체 선택 (폴더+자료)
 *
 * 입력 요소(input/textarea)에 focus가 있으면 자동 skip — 사용자가 검색창에 입력 중
 * Ctrl+X 누르면 검색창 텍스트 잘라내기로 처리.
 */

import { useEffect } from "react";
import { api } from "@/lib/api/client";
import type { DriveItem, ItemType } from "./_drive-shared";
import { itemKey } from "./_drive-shared";

type Toast = { show: (msg: string, kind?: "info" | "success" | "error") => void };

interface FolderRef { id: number }

interface Params {
  trashMode: boolean;
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  cutKeys: Set<string>;
  setCutKeys: (s: Set<string>) => void;
  clipMode: "cut" | "copy";
  setClipMode: (m: "cut" | "copy") => void;
  setCtx: (v: null) => void;
  items: DriveItem[];
  filtered: DriveItem[];
  filteredFolders: FolderRef[];
  currentFolderId: number | null;
  fetchAll: () => Promise<void> | void;
  doBulkSoftDelete: () => void;
  doBulkPermanent: () => void;
  toast: Toast;
}

export function useDriveKeyboardShortcuts(p: Params) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;

      const mod = e.ctrlKey || e.metaKey;

      if (e.key === "Escape") {
        p.setSelected(new Set());
        p.setCtx(null);
        p.setCutKeys(new Set());
      } else if ((e.key === "Delete" || e.key === "Backspace") && p.selected.size > 0) {
        e.preventDefault();
        if (p.trashMode) p.doBulkPermanent();
        else p.doBulkSoftDelete();
      } else if (mod && (e.key === "x" || e.key === "X")) {
        // Ctrl+X — 잘라내기. 자료만 (폴더 X).
        if (p.trashMode || p.selected.size === 0) return;
        const targets = Array.from(p.selected).filter((k) => !k.startsWith("folder:"));
        if (targets.length === 0) return;
        e.preventDefault();
        p.setCutKeys(new Set(targets));
        p.setClipMode("cut");
        p.toast.show(`${targets.length}개 자료 잘라내기 — Ctrl+V로 붙여넣기`, "info");
      } else if (mod && (e.key === "c" || e.key === "C")) {
        // Ctrl+C — 복사. 자료만.
        if (p.trashMode || p.selected.size === 0) return;
        const targets = Array.from(p.selected).filter((k) => !k.startsWith("folder:"));
        if (targets.length === 0) return;
        e.preventDefault();
        p.setCutKeys(new Set(targets));
        p.setClipMode("copy");
        p.toast.show(`${targets.length}개 자료 복사 — Ctrl+V로 붙여넣기`, "info");
      } else if (mod && (e.key === "v" || e.key === "V")) {
        // Ctrl+V — 현재 폴더에 cut/copy 자료 적용.
        if (p.trashMode || p.cutKeys.size === 0) return;
        e.preventDefault();
        (async () => {
          try {
            const targets = p.items.filter((x) => p.cutKeys.has(itemKey(x)));
            const endpoint = p.clipMode === "copy" ? "copy" : "move";
            let okCount = 0;
            const skipped: string[] = [];
            for (const x of targets) {
              try {
                await api.post(`/api/drive/items/${x.type}/${x.id}/${endpoint}`, {
                  folder_id: p.currentFolderId,
                });
                okCount++;
              } catch (err: any) {
                skipped.push(`${x.title}: ${err?.detail || err?.message || "실패"}`);
              }
            }
            p.setCutKeys(new Set());
            p.setSelected(new Set());
            await p.fetchAll();
            const verb = p.clipMode === "copy" ? "복사" : "이동";
            if (okCount > 0) p.toast.show(`${okCount}개 ${verb} 완료`, "success");
            if (skipped.length > 0) {
              p.toast.show(`${skipped.length}개 ${verb} 실패: ${skipped[0]}`, "error");
            }
          } catch (err: any) {
            alert(err?.detail || err?.message || "붙여넣기 실패");
          }
        })();
      } else if (mod && (e.key === "a" || e.key === "A")) {
        // Ctrl+A — 전체 선택
        if (p.trashMode) {
          e.preventDefault();
          p.setSelected(new Set(p.items.map((x) => itemKey(x))));
        } else {
          e.preventDefault();
          const allKeys = [
            ...p.filteredFolders.map((f) => `folder:${f.id}`),
            ...p.filtered.map((x) => itemKey(x)),
          ];
          p.setSelected(new Set(allKeys));
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    p.selected, p.trashMode, p.cutKeys, p.clipMode,
    p.items, p.filtered, p.filteredFolders, p.currentFolderId,
  ]);
}
