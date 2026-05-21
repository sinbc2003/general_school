"use client";

/**
 * 에디터 우클릭 컨텍스트 메뉴 + 표 Delete 모달.
 *
 * - editor.view.dom에 contextmenu listener 등록 → floating menu 표시
 * - 표 안일 때: 행/열 추가·삭제, 셀 병합·분리, 헤더 토글, 표 삭제
 * - 그 외: 잘라내기/복사/붙여넣기 (브라우저 기본 + clipboard API)
 * - Delete/Backspace 키 + 표 안 → 모달: 셀 내용만 / 행 / 열 / 표 전체
 */

import { useEffect, useState } from "react";
import { Editor } from "@tiptap/react";
import {
  Scissors, Copy, Clipboard as ClipIcon, Rows as RowsIcon, Columns,
  Merge, Split, Trash2, ChevronDown,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface MenuItem {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  danger?: boolean;
  divider?: boolean;
  disabled?: boolean;
}

interface State {
  open: boolean;
  x: number;
  y: number;
}

const INITIAL: State = { open: false, x: 0, y: 0 };


export function EditorContextMenu({ editor }: { editor: Editor | null }) {
  const [state, setState] = useState<State>(INITIAL);
  const [deleteModal, setDeleteModal] = useState(false);

  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom as HTMLElement;

    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      setState({ open: true, x: e.clientX, y: e.clientY });
    };
    const onKeyDown = (e: KeyboardEvent) => {
      // 표 안에서 Delete/Backspace → 모달 (selection이 cell 단위가 아니라 textblock인 경우는 기본 동작)
      if ((e.key === "Delete" || e.key === "Backspace") && editor.isActive("table")) {
        // 셀 선택(여러 셀) 또는 row/column 전체 선택 시에만 모달
        const { from, to } = editor.state.selection;
        if (from !== to) {
          // 텍스트 selection이면 default delete
          // CellSelection은 ProseMirror가 (from, to)를 cell 범위로 둠 — 이를 구분하기 어려움
          // 일단 표 안 + selection 있으면 modal
          e.preventDefault();
          setDeleteModal(true);
        }
      }
    };

    dom.addEventListener("contextmenu", onContext);
    dom.addEventListener("keydown", onKeyDown);
    return () => {
      dom.removeEventListener("contextmenu", onContext);
      dom.removeEventListener("keydown", onKeyDown);
    };
  }, [editor]);

  // 외부 클릭 닫기
  useEffect(() => {
    if (!state.open) return;
    const close = () => setState(INITIAL);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    return () => document.removeEventListener("mousedown", close);
  }, [state.open]);

  if (!editor) return null;

  const inTable = editor.isActive("table");
  const items: MenuItem[] = [];

  // 표 안일 때 표 조작
  if (inTable) {
    items.push(
      { label: "위에 행 추가", icon: RowsIcon, onClick: () => editor.chain().focus().addRowBefore().run() },
      { label: "아래에 행 추가", icon: RowsIcon, onClick: () => editor.chain().focus().addRowAfter().run() },
      { label: "행 삭제", icon: Trash2, onClick: () => editor.chain().focus().deleteRow().run(), danger: true },
      { label: "왼쪽에 열 추가", icon: Columns, onClick: () => editor.chain().focus().addColumnBefore().run(), divider: true },
      { label: "오른쪽에 열 추가", icon: Columns, onClick: () => editor.chain().focus().addColumnAfter().run() },
      { label: "열 삭제", icon: Trash2, onClick: () => editor.chain().focus().deleteColumn().run(), danger: true },
      { label: "셀 병합", icon: Merge, onClick: () => editor.chain().focus().mergeCells().run(), divider: true },
      { label: "셀 분리", icon: Split, onClick: () => editor.chain().focus().splitCell().run() },
      { label: "헤더 셀 토글", icon: ChevronDown, onClick: () => editor.chain().focus().toggleHeaderCell().run() },
      { label: "표 전체 삭제", icon: Trash2, onClick: () => editor.chain().focus().deleteTable().run(), danger: true, divider: true },
    );
  } else {
    items.push(
      { label: "잘라내기", icon: Scissors, onClick: () => document.execCommand("cut") },
      { label: "복사", icon: Copy, onClick: () => document.execCommand("copy") },
      { label: "붙여넣기", icon: ClipIcon, onClick: async () => {
        try {
          const text = await navigator.clipboard.readText();
          editor.chain().focus().insertContent(text).run();
        } catch { document.execCommand("paste"); }
      }},
    );
  }

  const exec = (item: MenuItem) => {
    item.onClick();
    setState(INITIAL);
  };

  // 화면 밖 보정
  const MENU_W = 220;
  const MENU_H = items.length * 36 + 12;
  const left = Math.min(state.x, typeof window !== "undefined" ? window.innerWidth - MENU_W - 8 : state.x);
  const top = Math.min(state.y, typeof window !== "undefined" ? window.innerHeight - MENU_H - 8 : state.y);

  return (
    <>
      {state.open && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          className="fixed z-50 w-[220px] bg-white border border-[#e8eaed] rounded-lg shadow-lg py-1.5"
          style={{ left, top }}
        >
          {items.map((item, i) => (
            <div key={i}>
              {item.divider && <div className="my-1 border-t border-border-default" />}
              <button
                type="button"
                onClick={() => exec(item)}
                disabled={item.disabled}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-caption hover:bg-bg-secondary disabled:opacity-40 ${
                  item.danger ? "text-status-error" : "text-text-primary"
                }`}
              >
                {item.icon && <item.icon size={13} />}
                {item.label}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Delete 모달 — 표 안에서 Delete/Backspace 누를 때 */}
      {deleteModal && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={() => setDeleteModal(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-xs p-4" onClick={(e) => e.stopPropagation()}>
            <div className="text-body font-medium text-text-primary mb-3">어떤 부분을 삭제할까요?</div>
            <div className="space-y-1.5">
              <DeleteOpt label="셀 내용만 지우기" onClick={() => {
                // 현재 selection 안 텍스트만 비움
                const { from, to } = editor.state.selection;
                editor.chain().focus().deleteRange({ from, to }).run();
                setDeleteModal(false);
              }} />
              <DeleteOpt label="현재 행 삭제" onClick={() => {
                editor.chain().focus().deleteRow().run();
                setDeleteModal(false);
              }} danger />
              <DeleteOpt label="현재 열 삭제" onClick={() => {
                editor.chain().focus().deleteColumn().run();
                setDeleteModal(false);
              }} danger />
              <DeleteOpt label="표 전체 삭제" onClick={() => {
                editor.chain().focus().deleteTable().run();
                setDeleteModal(false);
              }} danger />
            </div>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => setDeleteModal(false)}
                className="px-3 py-1 text-caption text-text-secondary hover:bg-bg-secondary rounded"
              >취소</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}


function DeleteOpt({
  label, onClick, danger,
}: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left text-caption px-3 py-2 rounded hover:bg-bg-secondary ${
        danger ? "text-status-error" : "text-text-primary"
      }`}
    >
      {label}
    </button>
  );
}
