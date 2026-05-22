"use client";

/**
 * 드라이브 grid view의 폴더 카드.
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

export function FolderCard({
  folder, isSelected, isDragOver,
  onClickSelect, onEnter, onDragOverFolder, onDragLeaveFolder, onDrop,
}: Props) {
  const key = `folder:${folder.id}`;
  return (
    <div
      data-drive-card
      data-drive-key={key}
      className={`group relative border-2 rounded-xl overflow-hidden hover:shadow-md transition-all cursor-pointer ${
        isDragOver
          ? "border-accent bg-accent/15 ring-2 ring-accent"
          : isSelected
          ? "border-[#673ab7] bg-[#e8def8] shadow-md"
          : "border-border-default bg-bg-primary"
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
      <div
        className="px-4 py-6 flex items-center justify-center"
        style={{ background: "linear-gradient(135deg, #fef3c7 0%, #fcd34d 100%)", minHeight: "100px" }}
      >
        <FolderIcon size={36} className="text-amber-600" />
      </div>
      <div className="px-4 py-3">
        <div className="text-body font-medium text-text-primary truncate flex items-center gap-1">
          {folder.is_system_locked
            ? `${String(folder.sort_order).padStart(2, "0")}. ${folder.name}`
            : folder.name}
          {folder.is_system_locked && <Lock size={10} className="text-text-tertiary" />}
        </div>
        <div className="text-[11px] text-text-tertiary mt-1">폴더</div>
      </div>
    </div>
  );
}
