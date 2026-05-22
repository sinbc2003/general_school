"use client";

/**
 * 드라이브 카드(그리드) 보기.
 *
 * DrivePage에서 추출. 폴더 카드 + 자료 카드를 동일 grid에 배치.
 * 정렬 컬럼 헤더는 없음 (list view 전용).
 *
 * props 압축: DriveListView와 동일한 selection/rename/dragDrop 객체 재사용.
 */

import type { FolderNode } from "./FolderSidebar";
import { FolderCard } from "./FolderCard";
import { ItemCard } from "./ItemCard";
import type { DriveItem } from "./_drive-shared";
import type {
  DriveSelectionProps, DriveRenameProps, DriveDragDropProps,
} from "./DriveListView";

interface Props {
  trashMode: boolean;
  filtered: DriveItem[];
  filteredFolders: FolderNode[];
  setCurrentFolderId: (id: number | null) => void;
  selection: DriveSelectionProps;
  rename: DriveRenameProps;
  dragDrop: DriveDragDropProps;
}

export function DriveGridView({
  trashMode, filtered, filteredFolders,
  setCurrentFolderId,
  selection, rename, dragDrop,
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
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {/* 폴더 카드 — 휴지통이 아닐 때만 */}
      {!trashMode && filteredFolders.map((f) => (
        <FolderCard
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
        return (
          <ItemCard
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
            isFavorited={favoritesSet.has(menuKey)}
            onToggleFavorite={toggleFavorite}
          />
        );
      })}
    </div>
  );
}
