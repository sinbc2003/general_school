"use client";

/**
 * 폴더 좌측 사이드바 — 사용자별 폴더 트리.
 *
 * - 평탄 list를 fetch해서 parent_id로 tree 구조 빌드
 * - 자동 폴더는 자물쇠 아이콘, 클릭 시 그 폴더 선택
 * - 수동 폴더만 이름변경/삭제 가능 (우클릭 메뉴)
 * - "+ 새 폴더" 버튼: 현재 선택된 폴더 안에 (선택 안 됐으면 루트에)
 *
 * props.currentFolderId:
 *   undefined → 전체 자료 (필터 안 함)
 *   null       → 루트 (no_folder=true, 폴더 밖 자료만)
 *   number     → 그 폴더 안 자료만
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Folder as FolderIcon,
  FolderOpen,
  Lock,
  ChevronRight,
  Plus,
  Pencil,
  Trash2,
  Home,
} from "lucide-react";
import { api } from "@/lib/api/client";

export interface FolderNode {
  id: number;
  owner_id: number;
  parent_id: number | null;
  name: string;
  auto_kind: string | null;
  semester_id: number | null;
  source_kind: string | null;
  source_id: number | null;
  sort_order: number;
  is_system_locked: boolean;
}

interface Props {
  currentFolderId: number | null | undefined;
  onSelect: (folderId: number | null | undefined) => void;
  onRefresh?: () => void; // 폴더 CRUD 후 부모의 자료 list 새로고침
}

interface TreeNode extends FolderNode {
  children: TreeNode[];
}

export function FolderSidebar({ currentFolderId, onSelect, onRefresh }: Props) {
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(() => {
    // 페이지 진입 시 모든 폴더 펼침 (사용자 친화)
    return new Set();
  });
  const [menu, setMenu] = useState<{ x: number; y: number; folder: FolderNode } | null>(null);

  const fetchFolders = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<{ items: FolderNode[] }>("/api/drive/folders");
      setFolders(r.items);
      // 첫 fetch 시 모두 펼침
      setExpanded(new Set(r.items.map((f) => f.id)));
    } catch {
      setFolders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFolders();
  }, [fetchFolders]);

  // tree 빌드
  const tree = useMemo<TreeNode[]>(() => {
    const map = new Map<number, TreeNode>();
    folders.forEach((f) => map.set(f.id, { ...f, children: [] }));
    const roots: TreeNode[] = [];
    folders.forEach((f) => {
      const node = map.get(f.id)!;
      if (f.parent_id == null) {
        roots.push(node);
      } else {
        const parent = map.get(f.parent_id);
        if (parent) parent.children.push(node);
      }
    });
    // sort_order로 정렬
    const sortRec = (nodes: TreeNode[]) => {
      nodes.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
      nodes.forEach((n) => sortRec(n.children));
    };
    sortRec(roots);
    return roots;
  }, [folders]);

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const createFolder = async (parentId: number | null) => {
    const raw = prompt("새 폴더 이름");
    if (!raw) return;
    const name = raw.trim();
    if (!name) return;
    try {
      await api.post("/api/drive/folders", { name, parent_id: parentId });
      await fetchFolders();
      onRefresh?.();
    } catch (e: any) {
      alert(e?.detail || e?.message || "폴더 생성 실패");
    }
  };

  const renameFolder = async (folder: FolderNode) => {
    if (folder.is_system_locked) {
      alert("자동 생성된 폴더는 이름을 바꿀 수 없습니다");
      return;
    }
    const raw = prompt("새 이름", folder.name);
    if (!raw) return;
    const name = raw.trim();
    if (!name || name === folder.name) return;
    try {
      await api.patch(`/api/drive/folders/${folder.id}`, { name });
      await fetchFolders();
    } catch (e: any) {
      alert(e?.detail || e?.message || "이름 변경 실패");
    }
  };

  const deleteFolder = async (folder: FolderNode) => {
    if (folder.is_system_locked) {
      alert("자동 생성된 폴더는 삭제할 수 없습니다");
      return;
    }
    if (!confirm(`"${folder.name}" 폴더를 삭제하시겠습니까?\n안의 자료는 폴더 밖으로 이동됩니다.`)) return;
    try {
      await api.delete(`/api/drive/folders/${folder.id}`);
      if (currentFolderId === folder.id) onSelect(undefined);
      await fetchFolders();
      onRefresh?.();
    } catch (e: any) {
      alert(e?.detail || e?.message || "폴더 삭제 실패");
    }
  };

  const renderNode = (node: TreeNode, depth: number) => {
    const isOpen = expanded.has(node.id);
    const isSelected = currentFolderId === node.id;
    const hasChildren = node.children.length > 0;
    return (
      <div key={node.id}>
        <div
          className={`group flex items-center gap-1 py-1 pr-2 text-[13px] cursor-pointer hover:bg-bg-secondary rounded ${
            isSelected ? "bg-accent/15 text-accent font-medium" : "text-text-primary"
          }`}
          style={{ paddingLeft: 4 + depth * 14 }}
          onClick={() => onSelect(node.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, folder: node });
          }}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(node.id);
              }}
              className="p-0.5 text-text-tertiary"
            >
              <ChevronRight
                size={12}
                className={`transition-transform ${isOpen ? "rotate-90" : ""}`}
              />
            </button>
          ) : (
            <span className="w-[18px]" />
          )}
          {isOpen && hasChildren ? (
            <FolderOpen size={14} className="text-amber-500 flex-shrink-0" />
          ) : (
            <FolderIcon
              size={14}
              className={node.is_system_locked ? "text-text-tertiary flex-shrink-0" : "text-amber-500 flex-shrink-0"}
            />
          )}
          <span className="truncate flex-1">
            {String(node.sort_order).padStart(2, "0")}. {node.name}
          </span>
          {node.is_system_locked && (
            <span title="자동 생성 폴더" className="flex-shrink-0 inline-flex">
              <Lock size={10} className="text-text-tertiary" />
            </span>
          )}
        </div>
        {isOpen && hasChildren && (
          <div>{node.children.map((c) => renderNode(c, depth + 1))}</div>
        )}
      </div>
    );
  };

  // 메뉴 외부 클릭 시 닫기
  useEffect(() => {
    if (!menu) return;
    const onClick = () => setMenu(null);
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [menu]);

  return (
    <div className="flex flex-col h-full w-[260px] flex-shrink-0 border-r border-border-default bg-bg-primary">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default">
        <div className="text-[12px] font-medium text-text-secondary">폴더</div>
        <button
          type="button"
          onClick={() =>
            createFolder(typeof currentFolderId === "number" ? currentFolderId : null)
          }
          className="p-1 rounded hover:bg-bg-secondary text-text-tertiary"
          title="새 폴더"
        >
          <Plus size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {/* 전체 / 폴더 밖 (루트) 단축 항목 */}
        <div
          className={`flex items-center gap-2 px-3 py-1 text-[13px] cursor-pointer rounded mx-1 ${
            currentFolderId === undefined
              ? "bg-accent/15 text-accent font-medium"
              : "hover:bg-bg-secondary text-text-primary"
          }`}
          onClick={() => onSelect(undefined)}
        >
          <Home size={14} />
          <span>전체</span>
        </div>
        <div
          className={`flex items-center gap-2 px-3 py-1 text-[13px] cursor-pointer rounded mx-1 ${
            currentFolderId === null
              ? "bg-accent/15 text-accent font-medium"
              : "hover:bg-bg-secondary text-text-primary"
          }`}
          onClick={() => onSelect(null)}
        >
          <FolderIcon size={14} className="text-text-tertiary" />
          <span>폴더 밖</span>
        </div>
        <div className="mt-2 px-1">
          {loading ? (
            <div className="px-3 py-2 text-[12px] text-text-tertiary">불러오는 중...</div>
          ) : tree.length === 0 ? (
            <div className="px-3 py-2 text-[12px] text-text-tertiary">
              아직 폴더가 없습니다.
            </div>
          ) : (
            tree.map((root) => renderNode(root, 0))
          )}
        </div>
      </div>

      {/* 폴더 우클릭 메뉴 */}
      {menu && (
        <div
          className="fixed z-50 bg-bg-primary border border-border-default rounded-md shadow-lg min-w-[160px] py-1"
          style={{ left: Math.min(menu.x, (typeof window !== "undefined" ? window.innerWidth : 1200) - 180), top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {!menu.folder.is_system_locked && (
            <>
              <button
                type="button"
                onClick={() => {
                  setMenu(null);
                  renameFolder(menu.folder);
                }}
                className="w-full text-left px-3 py-1.5 text-[12px] hover:bg-bg-secondary flex items-center gap-2"
              >
                <Pencil size={12} /> 이름 바꾸기
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenu(null);
                  deleteFolder(menu.folder);
                }}
                className="w-full text-left px-3 py-1.5 text-[12px] hover:bg-red-50 text-red-600 flex items-center gap-2"
              >
                <Trash2 size={12} /> 삭제
              </button>
              <div className="my-1 border-t border-border-default/50" />
            </>
          )}
          <button
            type="button"
            onClick={() => {
              setMenu(null);
              createFolder(menu.folder.id);
            }}
            className="w-full text-left px-3 py-1.5 text-[12px] hover:bg-bg-secondary flex items-center gap-2"
          >
            <Plus size={12} /> 안에 새 폴더
          </button>
          {menu.folder.is_system_locked && (
            <div className="px-3 py-1.5 text-[11px] text-text-tertiary border-t border-border-default/50 mt-1">
              <Lock size={10} className="inline mr-1" /> 자동 생성된 폴더
            </div>
          )}
        </div>
      )}
    </div>
  );
}
