"use client";

/**
 * 드라이브 list view의 폴더 행.
 * - 더블클릭으로 진입
 * - 자료 드래그 → drop 시 onDrop 콜백 호출 (부모가 api.post)
 * - Ctrl+클릭 토글 선택
 */

import { Folder as FolderIcon, Lock } from "lucide-react";
import type { FolderNode } from "./FolderSidebar";
import type { ItemType } from "./_drive-shared";

interface Props {
  folder: FolderNode;
  isSelected: boolean;
  isDragOver: boolean;
  onClickSelect: (key: string, additive: boolean) => void;
  onEnter: (folderId: number) => void;
  onDragOverFolder: (folderId: number) => void;
  onDragLeaveFolder: (folderId: number) => void;
  onDrop: (folderId: number, payload: { type: ItemType; id: number }[]) => void | Promise<void>;
}

export function FolderRow({
  folder, isSelected, isDragOver,
  onClickSelect, onEnter, onDragOverFolder, onDragLeaveFolder, onDrop,
}: Props) {
  const key = `folder:${folder.id}`;
  return (
    <tr
      data-drive-row
      data-drive-key={key}
      className={`border-b border-border-default/50 cursor-pointer ${
        isDragOver
          ? "bg-accent/20 ring-2 ring-accent ring-inset"
          : isSelected
          ? "bg-[#e8def8] hover:bg-[#d7c4f3]"
          : "hover:bg-bg-secondary/50"
      }`}
      onClick={(e) => onClickSelect(key, e.ctrlKey || e.metaKey)}
      onDoubleClick={() => onEnter(folder.id)}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("application/x-drive-items")) {
          e.preventDefault();
          onDragOverFolder(folder.id);
        }
      }}
      onDragLeave={() => onDragLeaveFolder(folder.id)}
      onDrop={async (e) => {
        e.preventDefault();
        const payload = e.dataTransfer.getData("application/x-drive-items");
        if (!payload) return;
        try {
          const list: { type: ItemType; id: number }[] = JSON.parse(payload);
          await onDrop(folder.id, list);
        } catch {
          /* ignored */
        }
      }}
    >
      <td className="px-4 py-2">
        <FolderIcon size={18} className="text-amber-500" />
      </td>
      <td className="px-2 py-2">
        <span className="text-text-primary flex items-center gap-1.5">
          {folder.is_system_locked
            ? `${String(folder.sort_order).padStart(2, "0")}. ${folder.name}`
            : folder.name}
          {folder.is_system_locked && <Lock size={10} className="text-text-tertiary" />}
        </span>
      </td>
      <td className="px-2 py-2 text-text-secondary">폴더</td>
      <td className="px-2 py-2 text-text-tertiary">
        {(folder as any).updated_at?.slice(0, 16).replace("T", " ") || ""}
      </td>
      <td className="px-2 py-2 text-right text-text-tertiary">—</td>
      <td className="px-2 py-2"></td>
    </tr>
  );
}
