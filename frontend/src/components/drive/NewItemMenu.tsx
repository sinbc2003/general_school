"use client";

/**
 * 드라이브 우상단 "+ 신규" 드롭다운 메뉴.
 *
 * - 새 폴더 (prompt → /api/drive/folders POST)
 * - docs/sheets/decks/surveys/hwps — createNew 콜백 위임 (페이지 이동까지 부모 책임)
 */

import { Plus, ChevronDown, Folder as FolderIcon } from "lucide-react";
import { api } from "@/lib/api/client";
import { TYPE_META, ITEM_TYPES, type ItemType } from "./_drive-shared";

interface Props {
  show: boolean;
  setShow: (v: boolean) => void;
  creating: boolean;
  currentFolderId: number | null;
  fetchAll: () => Promise<void> | void;
  createNew: (type: ItemType) => Promise<void> | void;
  /** 메뉴에서 제외할 타입 — 학생 모드에선 교사 전용 도구(단어장·보드) 숨김 */
  excludeTypes?: ItemType[];
}

export function NewItemMenu({
  show, setShow, creating, currentFolderId, fetchAll, createNew, excludeTypes,
}: Props) {
  const visibleTypes = ITEM_TYPES.filter((t) => !(excludeTypes || []).includes(t));
  return (
    <div className="relative">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setShow(!show); }}
        disabled={creating}
        className="px-4 py-2 text-[13px] bg-accent text-white rounded-md hover:opacity-90 flex items-center gap-1.5 disabled:opacity-50"
      >
        <Plus size={14} /> 신규 <ChevronDown size={12} />
      </button>
      {show && (
        <div
          className="absolute right-0 top-full mt-1 z-20 bg-bg-primary border border-border-default rounded-md shadow-lg min-w-[200px] py-1"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={async () => {
              setShow(false);
              const raw = prompt("새 폴더 이름");
              if (!raw?.trim()) return;
              try {
                await api.post("/api/drive/folders", {
                  name: raw.trim(),
                  parent_id: currentFolderId,
                });
                await fetchAll();
              } catch (e: any) {
                alert(e?.detail || e?.message || "폴더 생성 실패");
              }
            }}
            className="w-full text-left px-3 py-2 text-[13px] hover:bg-bg-secondary flex items-center gap-2 text-text-primary"
          >
            <FolderIcon size={14} className="text-amber-500" /> 새 폴더
          </button>
          <div className="my-1 border-t border-border-default/50" />
          {visibleTypes.map((t) => {
            const m = TYPE_META[t];
            const Icon = m.icon;
            return (
              <button
                key={t}
                type="button"
                onClick={() => createNew(t)}
                className="w-full text-left px-3 py-2 text-[13px] hover:bg-bg-secondary flex items-center gap-2 text-text-primary"
              >
                <Icon size={14} style={{ color: m.color }} />
                {m.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
