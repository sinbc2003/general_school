"use client";

/**
 * 자료를 다른 폴더로 이동 모달.
 *
 * - 본인 폴더 트리 표시 (자동/수동 모두). "폴더 밖" 옵션 포함.
 * - 단일 또는 다중 자료 이동.
 * - 잠금 폴더에도 이동 허용 (사용자가 자료를 자동 폴더에 정리 가능).
 */

import { useEffect, useMemo, useState } from "react";
import { X, Folder as FolderIcon, FolderOpen, Lock, ChevronRight, Home } from "lucide-react";
import { api } from "@/lib/api/client";
import type { FolderNode } from "./FolderSidebar";

interface TargetItem {
  type: "docs" | "sheets" | "decks" | "surveys" | "hwps";
  id: number;
  title: string;
}

interface Props {
  targets: TargetItem[];
  onClose: () => void;
  onMoved: () => void;
}

interface TreeNode extends FolderNode {
  children: TreeNode[];
}

export function MoveToFolderModal({ targets, onClose, onMoved }: Props) {
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [selected, setSelected] = useState<number | null | undefined>(undefined);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get<{ items: FolderNode[] }>("/api/drive/folders");
        setFolders(r.items);
        setExpanded(new Set(r.items.map((f) => f.id)));
      } catch {
        setFolders([]);
      }
    })();
  }, []);

  const tree = useMemo<TreeNode[]>(() => {
    const map = new Map<number, TreeNode>();
    folders.forEach((f) => map.set(f.id, { ...f, children: [] }));
    const roots: TreeNode[] = [];
    folders.forEach((f) => {
      const node = map.get(f.id)!;
      if (f.parent_id == null) roots.push(node);
      else {
        const parent = map.get(f.parent_id);
        if (parent) parent.children.push(node);
      }
    });
    const sortRec = (nodes: TreeNode[]) => {
      nodes.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
      nodes.forEach((n) => sortRec(n.children));
    };
    sortRec(roots);
    return roots;
  }, [folders]);

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderNode = (node: TreeNode, depth: number) => {
    const isOpen = expanded.has(node.id);
    const isSelected = selected === node.id;
    const hasChildren = node.children.length > 0;
    return (
      <div key={node.id}>
        <div
          className={`group flex items-center gap-1 py-1 pr-2 text-[13px] cursor-pointer hover:bg-bg-secondary rounded ${
            isSelected ? "bg-accent/15 text-accent font-medium" : "text-text-primary"
          }`}
          style={{ paddingLeft: 4 + depth * 14 }}
          onClick={() => setSelected(node.id)}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggle(node.id);
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
          {node.is_system_locked && <Lock size={10} className="text-text-tertiary flex-shrink-0" />}
        </div>
        {isOpen && hasChildren && <div>{node.children.map((c) => renderNode(c, depth + 1))}</div>}
      </div>
    );
  };

  const submit = async () => {
    if (selected === undefined) {
      alert("이동할 폴더를 선택하세요 (또는 폴더 밖)");
      return;
    }
    setSubmitting(true);
    try {
      for (const t of targets) {
        await api.post(`/api/drive/items/${t.type}/${t.id}/move`, {
          folder_id: selected,
        });
      }
      onMoved();
      onClose();
    } catch (e: any) {
      alert(e?.detail || e?.message || "이동 실패");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-bg-primary rounded-lg shadow-xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <h3 className="text-[14px] font-semibold text-text-primary">
            {targets.length === 1 ? "폴더로 이동" : `${targets.length}개 자료 이동`}
          </h3>
          <button type="button" onClick={onClose} className="text-text-tertiary hover:text-text-primary">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-2 px-1">
          <div
            className={`flex items-center gap-2 px-3 py-1.5 text-[13px] cursor-pointer rounded mx-1 ${
              selected === null
                ? "bg-accent/15 text-accent font-medium"
                : "hover:bg-bg-secondary text-text-primary"
            }`}
            onClick={() => setSelected(null)}
          >
            <Home size={14} />
            <span>폴더 밖 (루트)</span>
          </div>
          <div className="mt-2 px-1">
            {tree.length === 0 ? (
              <div className="px-3 py-2 text-[12px] text-text-tertiary">아직 폴더가 없습니다.</div>
            ) : (
              tree.map((root) => renderNode(root, 0))
            )}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-default">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-[13px] text-text-secondary hover:bg-bg-secondary rounded"
          >
            취소
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || selected === undefined}
            className="px-3 py-1.5 text-[13px] bg-accent text-white rounded hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "이동 중..." : "이동"}
          </button>
        </div>
      </div>
    </div>
  );
}
