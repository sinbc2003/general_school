"use client";

/**
 * 드라이브 grid view의 자료 카드.
 */

import { MoreVertical, RotateCcw, Trash2, Star } from "lucide-react";
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
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onMenuToggle: () => void;
  onMenuClose: () => void;
  onSoftDelete: (item: DriveItem) => void;
  onRestore: (item: DriveItem) => void;
  onPermanent: (item: DriveItem) => void;
  getDragPayload: () => { type: ItemType; id: number }[];
  isFavorited?: boolean;
  onToggleFavorite?: (item: DriveItem) => void;
}

export function ItemCard({
  item, trashMode, isSelected, isCut, isMenuOpen,
  renaming, renameDraft, setRenameDraft, commitRename, cancelRename,
  onClick, onDoubleClick, onContextMenu, onMenuToggle, onMenuClose,
  onSoftDelete, onRestore, onPermanent, getDragPayload,
  isFavorited, onToggleFavorite,
}: Props) {
  const m = TYPE_META[item.type];
  const Icon = m.icon;
  const menuKey = `${item.type}:${item.id}`;

  return (
    <div
      data-drive-card
      data-drive-key={menuKey}
      draggable={!trashMode}
      className={`group relative border-2 rounded-xl overflow-hidden hover:shadow-md transition-all cursor-pointer ${
        isCut ? "opacity-50" : ""
      } ${
        isSelected
          ? "border-[#673ab7] bg-[#e8def8] shadow-md"
          : "border-border-default bg-bg-primary"
      }`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => { e.stopPropagation(); onContextMenu(e); }}
      onDragStart={(e) => {
        const list = getDragPayload();
        e.dataTransfer.setData("application/x-drive-items", JSON.stringify(list));
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      <div
        className={`relative px-4 py-6 flex items-center justify-center ${trashMode ? "opacity-60" : ""}`}
        style={{ background: m.bg, minHeight: "100px" }}
      >
        <Icon size={36} style={{ color: m.color }} />
        {onToggleFavorite && !trashMode && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(item); }}
            className={`absolute top-2 right-2 p-1 rounded-full bg-white/80 hover:bg-white ${
              isFavorited ? "text-amber-500" : "text-text-tertiary opacity-0 group-hover:opacity-100"
            }`}
            title={isFavorited ? "즐겨찾기 해제" : "즐겨찾기 추가"}
          >
            <Star size={14} fill={isFavorited ? "currentColor" : "none"} />
          </button>
        )}
      </div>
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
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
                className="px-2 py-0.5 border border-accent rounded outline-none bg-white text-text-primary w-full"
              />
            ) : (
              <div className="text-body font-medium text-text-primary truncate">{item.title}</div>
            )}
            <div className="text-[11px] text-text-tertiary mt-1">
              {trashMode && item.deleted_at
                ? `삭제 ${item.deleted_at.slice(0, 16).replace("T", " ")}`
                : item.updated_at
                ? `수정 ${item.updated_at.slice(0, 16).replace("T", " ")}`
                : ""}
            </div>
            <div className="text-[11px] text-text-tertiary mt-0.5">
              {m.label} · {formatMB(item.storage_bytes)}
            </div>
          </div>
          {/* ⋮ 메뉴 */}
          <div className="relative">
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
        </div>
      </div>
    </div>
  );
}
