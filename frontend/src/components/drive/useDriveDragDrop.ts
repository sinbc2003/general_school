"use client";

/**
 * 드라이브 드래그&드롭 — 폴더 위에 자료 drop 시 이동.
 *
 * DrivePage에서 추출 (state + handlers).
 * - dragOverFolderId: 현재 hover 중인 폴더 ID (visual highlight)
 * - onDragOverFolder / onDragLeaveFolder / onDrop: FolderRow·FolderCard에 props
 */

import { useState, useCallback } from "react";
import { api } from "@/lib/api/client";
import type { ItemType } from "./_drive-shared";

export function useDriveDragDrop(params: {
  fetchAll: () => Promise<void>;
  setSelected: (next: Set<string>) => void;
}) {
  const { fetchAll, setSelected } = params;
  const [dragOverFolderId, setDragOverFolderId] = useState<number | null>(null);

  const onDragOverFolder = useCallback((fid: number) => {
    setDragOverFolderId(fid);
  }, []);

  const onDragLeaveFolder = useCallback((fid: number) => {
    setDragOverFolderId((cur) => (cur === fid ? null : cur));
  }, []);

  const onDrop = useCallback(
    async (fid: number, list: { type: ItemType; id: number }[]) => {
      setDragOverFolderId(null);
      try {
        for (const t of list) {
          await api.post(`/api/drive/items/${t.type}/${t.id}/move`, {
            folder_id: fid,
          });
        }
        setSelected(new Set());
        await fetchAll();
      } catch (err: any) {
        alert(err?.detail || err?.message || "이동 실패");
      }
    },
    [fetchAll, setSelected],
  );

  return { dragOverFolderId, onDragOverFolder, onDragLeaveFolder, onDrop };
}
