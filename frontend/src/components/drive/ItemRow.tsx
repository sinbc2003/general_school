"use client";

/**
 * 드라이브 list view의 자료 행.
 * - draggable=true → 드래그 시작 시 selected items 또는 단일 item을 payload로
 * - 클릭 = 선택, 더블클릭 = 열기, 우클릭 = context menu
 * - F2/메뉴로 이름 변경 (rename input)
 * - ⋮ 메뉴: 휴지통/복구/영구삭제
 */

import { MoreVertical, RotateCcw, Trash2 } from "lucide-react";
import { TYPE_META, formatMB, type DriveItem, type ItemType } from "./_drive-shared";

interface Props {
  item: DriveItem;
  trashMode: boolean;
  isSelected: boolean;
  isCut: boolean;
  isMenuOpen: boolean;
  renaming: boolean;
  renameDraft: string;
  setRenameDraft: (s: string) => void;
  commitRename: (item: DriveItem) => void;
  cancelRename: () => void;
  // 클릭 핸들러 — Ctrl/Shift 등 처리는 부모에서 (selected state coupling)
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onMenuToggle: () => void;
  onMenuClose: () => void;
  onSoftDelete: (item: DriveItem) => void;
  onRestore: (item: DriveItem) => void;
  onPermanent: (item: DriveItem) => void;
  // 드래그 시작 시 페이로드 — 부모가 selected 처리해 payload 결정
  getDragPayload: () => { type: ItemType; id: number }[];
}

export function ItemRow({
  item, trashMode, isSelected, isCut, isMenuOpen,
  renaming, renameDraft, setRenameDraft, commitRename, cancelRename,
  onClick, onDoubleClick, onContextMenu, onMenuToggle, onMenuClose,
  onSoftDelete, onRestore, onPermanent, getDragPayload,
}: Props) {
  const m = TYPE_META[item.type];
  const Icon = m.icon;
  const menuKey = `${item.type}:${item.id}`;
  const dateStr = trashMode
    ? item.deleted_at?.slice(0, 16).replace("T", " ") || ""
    : item.updated_at?.slice(0, 16).replace("T", " ") || "";

  return (
    <tr
      data-drive-row
      data-drive-key={menuKey}
      draggable={!trashMode}
      className={`border-b border-border-default/50 cursor-pointer ${
        isCut ? "opacity-50" : ""
      } ${
        isSelected ? "bg-[#e8def8] hover:bg-[#d7c4f3]" : "hover:bg-bg-secondary/50"
      }`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onDragStart={(e) => {
        const list = getDragPayload();
        e.dataTransfer.setData("application/x-drive-items", JSON.stringify(list));
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      <td className="px-4 py-2">
        <Icon size={18} style={{ color: m.color }} />
      </td>
      <td className="px-2 py-2">
        {renaming ? (
          <input
            autoFocus
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onBlur={() => commitRename(item)}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitRename(item); }
              else if (e.key === "Escape") { e.preventDefault(); cancelRename(); }
            }}
            className="px-2 py-0.5 border border-accent rounded outline-none bg-white text-text-primary w-full max-w-md"
          />
        ) : (
          <span className="text-text-primary">{item.title}</span>
        )}
      </td>
      <td className="px-2 py-2 text-text-secondary">{m.label}</td>
      <td className="px-2 py-2 text-text-tertiary">{dateStr}</td>
      <td className="px-2 py-2 text-right text-text-tertiary">{formatMB(item.storage_bytes)}</td>
      <td className="px-2 py-2 text-right">
        <div className="relative inline-block">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onMenuToggle(); }}
            className="p-1 rounded hover:bg-bg-secondary text-text-tertiary"
          >
            <MoreVertical size={14} />
          </button>
          {isMenuOpen && (
            <div
              className="absolute right-0 top-full mt-1 z-10 bg-bg-primary border border-border-default rounded-md shadow-lg min-w-[140px] py-1"
              onClick={(e) => e.stopPropagation()}
            >
              {trashMode ? (
                <>
                  <button
                    type="button"
                    onClick={() => { onMenuClose(); onRestore(item); }}
                    className="w-full text-left px-3 py-2 text-[12px] hover:bg-bg-secondary flex items-center gap-2"
                  >
                    <RotateCcw size={12} /> 복구
                  </button>
                  <button
                    type="button"
                    onClick={() => { onMenuClose(); onPermanent(item); }}
                    className="w-full text-left px-3 py-2 text-[12px] hover:bg-red-50 text-red-600 flex items-center gap-2"
                  >
                    <Trash2 size={12} /> 영구 삭제
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => { onMenuClose(); onSoftDelete(item); }}
                  className="w-full text-left px-3 py-2 text-[12px] hover:bg-red-50 text-red-600 flex items-center gap-2"
                >
                  <Trash2 size={12} /> 휴지통으로 이동
                </button>
              )}
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}
