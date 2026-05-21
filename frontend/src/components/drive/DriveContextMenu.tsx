"use client";

/**
 * 드라이브 우클릭 컨텍스트 메뉴.
 *
 * - 항목 우클릭 → 열기 / 새 창에서 / 이름 바꾸기 / 공유 / 휴지통
 * - 빈 영역 우클릭 → "새로 만들기" + 4개 도구
 * - selected 개수에 따라 라벨 자동 변경 (N개)
 */

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export type DriveItemType = "docs" | "sheets" | "decks" | "surveys" | "hwps";

interface CtxItem {
  type: DriveItemType;
  id: number;
  title: string;
}

interface NewMeta {
  label: string;
  icon: LucideIcon;
  color: string;
}

interface Props {
  x: number;
  y: number;
  target: CtxItem | null;
  selectedCount: number;
  trashTab: boolean;
  newMenu: Array<{ type: DriveItemType; meta: NewMeta }>;
  // 액션 핸들러
  onOpen: (it: CtxItem) => void;
  onOpenNewWindow: (it: CtxItem) => void;
  onRename: (it: CtxItem) => void;
  onShare: (it: CtxItem) => void;
  onSoftDelete: () => void;
  onRestore: () => void;
  onPermanent: () => void;
  onCreateNew: (type: DriveItemType) => void;
  onClose: () => void;
}

export function DriveContextMenu({
  x, y, target, selectedCount, trashTab, newMenu,
  onOpen, onOpenNewWindow, onRename, onShare,
  onSoftDelete, onRestore, onPermanent, onCreateNew, onClose,
}: Props) {
  const MENU_W = 200;
  const MENU_H = 280;
  const left = typeof window !== "undefined"
    ? Math.min(x, window.innerWidth - MENU_W - 10)
    : x;
  const top = typeof window !== "undefined"
    ? Math.min(y, window.innerHeight - MENU_H - 10)
    : y;

  return (
    <>
      <div className="fixed inset-0 z-40" onMouseDown={onClose} />
      <div
        className="fixed z-50 w-[200px] bg-white border border-[#e8eaed] rounded-lg shadow-lg py-1.5 text-caption"
        style={{ left, top }}
        onClick={(e) => e.stopPropagation()}
      >
        {target ? (
          <>
            {!trashTab && (
              <MenuItem onClick={() => { onOpen(target); onClose(); }}>열기</MenuItem>
            )}
            {!trashTab && selectedCount <= 1 && (
              <MenuItem onClick={() => { onOpenNewWindow(target); onClose(); }}>
                새 창에서 열기
              </MenuItem>
            )}
            {!trashTab && selectedCount <= 1 && (
              <MenuItem
                onClick={() => { onRename(target); onClose(); }}
                hint="F2"
              >
                이름 바꾸기
              </MenuItem>
            )}
            {!trashTab && selectedCount <= 1 && target.type !== "surveys" && (
              <MenuItem onClick={() => { onShare(target); onClose(); }}>
                공유...
              </MenuItem>
            )}
            <div className="my-1 h-px bg-border-default" />
            {trashTab ? (
              <>
                <MenuItem onClick={() => { onRestore(); onClose(); }}>
                  복구{selectedCount > 1 ? ` (${selectedCount}개)` : ""}
                </MenuItem>
                <MenuItem danger onClick={() => { onPermanent(); onClose(); }}>
                  영구 삭제{selectedCount > 1 ? ` (${selectedCount}개)` : ""}
                </MenuItem>
              </>
            ) : (
              <MenuItem danger onClick={() => { onSoftDelete(); onClose(); }}>
                휴지통으로 이동{selectedCount > 1 ? ` (${selectedCount}개)` : ""}
              </MenuItem>
            )}
          </>
        ) : (
          <>
            <div className="px-3 py-1.5 text-[11px] text-text-tertiary uppercase tracking-wide">
              새로 만들기
            </div>
            {newMenu.map(({ type, meta }) => {
              const Icon = meta.icon;
              return (
                <button
                  key={type}
                  onClick={() => { onCreateNew(type); onClose(); }}
                  className="w-full text-left px-3 py-2 hover:bg-bg-secondary inline-flex items-center gap-2"
                >
                  <Icon size={14} style={{ color: meta.color }} /> {meta.label}
                </button>
              );
            })}
          </>
        )}
      </div>
    </>
  );
}


function MenuItem({
  children, onClick, danger, hint,
}: { children: ReactNode; onClick: () => void; danger?: boolean; hint?: string }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2 flex items-center justify-between ${
        danger ? "hover:bg-red-50 text-red-600" : "hover:bg-bg-secondary text-text-primary"
      }`}
    >
      <span>{children}</span>
      {hint && <span className="text-[10.5px] text-text-tertiary">{hint}</span>}
    </button>
  );
}
