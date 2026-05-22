"use client";

/**
 * 드라이브 자세히(리스트) 보기 — 테이블 형식.
 *
 * DrivePage에서 추출. 폴더 행(위) + 자료 행(아래) 동일 테이블.
 * 정렬 헤더(SortableTh) 포함. 행은 FolderRow / ItemRow 사용.
 *
 * props 압축: selection·rename·dragDrop 객체 단위로 묶어서 drilling 부담 감소.
 */

import type { Dispatch, SetStateAction } from "react";
import type { FolderNode } from "./FolderSidebar";
import { FolderRow } from "./FolderRow";
import { ItemRow } from "./ItemRow";
import { SortableTh } from "./SortableTh";
import type {
  DriveItem, ItemType, SortKey, SortDir,
} from "./_drive-shared";

export interface DriveSelectionProps {
  selected: Set<string>;
  setSelected: Dispatch<SetStateAction<Set<string>>>;
  cutKeys: Set<string>;
  favoritesSet: Set<string>;
  toggleFavorite: (it: DriveItem) => void | Promise<void>;
  menuOpen: string | null;
  setMenuOpen: (key: string | null) => void;
  onItemClick: (it: DriveItem, e: React.MouseEvent) => void;
  onItemDoubleClick: (it: DriveItem, e: React.MouseEvent) => void;
  onItemContextMenu: (it: DriveItem | null, e: React.MouseEvent) => void;
  onSoftDelete: (it: DriveItem) => Promise<void> | void;
  onRestore: (it: DriveItem) => Promise<void> | void;
  onPermanent: (it: DriveItem) => Promise<void> | void;
  items: DriveItem[];
  itemKey: (it: DriveItem) => string;
}

export interface DriveRenameProps {
  renamingKey: string | null;
  renameDraft: string;
  setRenameDraft: (v: string) => void;
  commitRename: (it: DriveItem) => Promise<void> | void;
  cancelRename: () => void;
}

export interface DriveDragDropProps {
  dragOverFolderId: number | null;
  onDragOverFolder: (folderId: number) => void;
  onDragLeaveFolder: (folderId: number) => void;
  onDrop: (folderId: number, list: { type: ItemType; id: number }[]) => Promise<void> | void;
}

interface Props {
  trashMode: boolean;
  filtered: DriveItem[];
  filteredFolders: FolderNode[];
  sortKey: SortKey;
  sortDir: SortDir;
  toggleSort: (key: SortKey) => void;
  setCurrentFolderId: (id: number | null) => void;
  selection: DriveSelectionProps;
  rename: DriveRenameProps;
  dragDrop: DriveDragDropProps;
  matchMap: Map<string, { snippet: string | null; matchField: string }>;
}

export function DriveListView({
  trashMode, filtered, filteredFolders,
  sortKey, sortDir, toggleSort,
  setCurrentFolderId,
  selection, rename, dragDrop,
  matchMap,
}: Props) {
  const {
    selected, setSelected, cutKeys, favoritesSet, toggleFavorite,
    menuOpen, setMenuOpen,
    onItemClick, onItemDoubleClick, onItemContextMenu,
    onSoftDelete, onRestore, onPermanent,
    items, itemKey,
  } = selection;
  const { renamingKey, renameDraft, setRenameDraft, commitRename, cancelRename } = rename;
  const { dragOverFolderId, onDragOverFolder, onDragLeaveFolder, onDrop } = dragDrop;

  return (
    <div className="bg-bg-primary border border-border-default rounded-lg">
      <table className="w-full text-[13px]">
        <thead className="bg-bg-secondary border-b border-border-default text-text-tertiary sticky top-0 z-10">
          <tr>
            <th className="px-4 py-2 text-left font-medium w-10"></th>
            <SortableTh sortKey="name" currentKey={sortKey} dir={sortDir} onClick={toggleSort}>
              이름
            </SortableTh>
            <th className="px-2 py-2 text-left font-medium w-32">유형</th>
            <SortableTh
              sortKey="updated"
              currentKey={sortKey}
              dir={sortDir}
              onClick={toggleSort}
              className="w-40"
            >
              {trashMode ? "삭제일" : "수정일"}
            </SortableTh>
            <SortableTh
              sortKey="size"
              currentKey={sortKey}
              dir={sortDir}
              onClick={toggleSort}
              align="right"
              className="w-24"
            >
              크기
            </SortableTh>
            <th className="px-2 py-2 w-12"></th>
          </tr>
        </thead>
        <tbody>
          {/* 폴더 행 — 휴지통 아닐 때만 */}
          {!trashMode && filteredFolders.map((f) => (
            <FolderRow
              key={`folder:${f.id}`}
              folder={f}
              isSelected={selected.has(`folder:${f.id}`)}
              isDragOver={dragOverFolderId === f.id}
              onClickSelect={(key, additive) => {
                if (additive) {
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  });
                } else {
                  setSelected(new Set([key]));
                }
              }}
              onEnter={(fid) => { setCurrentFolderId(fid); setSelected(new Set()); }}
              onDragOverFolder={onDragOverFolder}
              onDragLeaveFolder={onDragLeaveFolder}
              onDrop={onDrop}
            />
          ))}
          {filtered.map((it) => {
            const menuKey = `${it.type}:${it.id}`;
            const match = matchMap.get(menuKey);
            return (
              <ItemRow
                key={menuKey}
                item={it}
                trashMode={trashMode}
                isSelected={selected.has(menuKey)}
                isCut={cutKeys.has(menuKey)}
                isMenuOpen={menuOpen === menuKey}
                renaming={renamingKey === menuKey}
                renameDraft={renameDraft}
                setRenameDraft={setRenameDraft}
                commitRename={commitRename}
                cancelRename={cancelRename}
                onClick={(e) => onItemClick(it, e)}
                onDoubleClick={(e) => onItemDoubleClick(it, e)}
                onContextMenu={(e) => onItemContextMenu(it, e)}
                onMenuToggle={() => setMenuOpen(menuOpen === menuKey ? null : menuKey)}
                onMenuClose={() => setMenuOpen(null)}
                onSoftDelete={onSoftDelete}
                onRestore={onRestore}
                onPermanent={onPermanent}
                getDragPayload={() =>
                  selected.has(menuKey)
                    ? items.filter((x) => selected.has(itemKey(x))).map((x) => ({ type: x.type, id: x.id }))
                    : [{ type: it.type, id: it.id }]
                }
                searchSnippet={match?.snippet}
                searchMatchField={match?.matchField}
                isFavorited={favoritesSet.has(menuKey)}
                onToggleFavorite={toggleFavorite}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
