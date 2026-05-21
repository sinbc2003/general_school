"use client";

/**
 * 표 셀 안에 cursor가 있을 때 자동 floating 메뉴.
 *
 * - selection이 table 내부면 cursor 위에 작은 메뉴
 * - 핵심 액션 5개: 행 위/아래 추가, 열 좌/우 추가, 셀 병합
 * - 우클릭 메뉴(EditorContextMenu)와 별개 — 우클릭은 전체 메뉴, 이건 빠른 액세스
 */

import { useEffect, useState } from "react";
import { Editor } from "@tiptap/react";
import {
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Merge,
} from "lucide-react";

interface State {
  visible: boolean;
  left: number;
  top: number;
}

export function TableBubbleMenu({ editor }: { editor: Editor | null }) {
  const [state, setState] = useState<State>({ visible: false, left: 0, top: 0 });

  useEffect(() => {
    if (!editor) return;
    const updateMenu = () => {
      if (!editor.isActive("table")) {
        setState((s) => s.visible ? { ...s, visible: false } : s);
        return;
      }
      const { from } = editor.state.selection;
      try {
        const coords = editor.view.coordsAtPos(from);
        // cell 위쪽에 menu 표시 (top - 36)
        setState({
          visible: true,
          left: coords.left,
          top: coords.top - 38,
        });
      } catch {
        setState((s) => s.visible ? { ...s, visible: false } : s);
      }
    };

    editor.on("selectionUpdate", updateMenu);
    editor.on("transaction", updateMenu);
    editor.on("focus", updateMenu);
    editor.on("blur", () => setState((s) => ({ ...s, visible: false })));

    return () => {
      editor.off("selectionUpdate", updateMenu);
      editor.off("transaction", updateMenu);
      editor.off("focus", updateMenu);
    };
  }, [editor]);

  if (!editor || !state.visible) return null;

  // 화면 좌측 밖 보정
  const left = Math.max(8, Math.min(state.left, typeof window !== "undefined" ? window.innerWidth - 250 : state.left));
  const top = Math.max(8, state.top);

  return (
    <div
      className="fixed z-30 bg-white border border-[#e8eaed] rounded-md shadow-md px-1 py-0.5 flex items-center gap-0.5"
      style={{ left, top }}
      onMouseDown={(e) => e.preventDefault()} // editor blur 방지
    >
      <BtnIcon
        title="위에 행 추가"
        onClick={() => editor.chain().focus().addRowBefore().run()}
        icon={<ArrowUp size={13} />}
      />
      <BtnIcon
        title="아래에 행 추가"
        onClick={() => editor.chain().focus().addRowAfter().run()}
        icon={<ArrowDown size={13} />}
      />
      <span className="mx-0.5 w-px h-4 bg-border-default" />
      <BtnIcon
        title="왼쪽에 열 추가"
        onClick={() => editor.chain().focus().addColumnBefore().run()}
        icon={<ArrowLeft size={13} />}
      />
      <BtnIcon
        title="오른쪽에 열 추가"
        onClick={() => editor.chain().focus().addColumnAfter().run()}
        icon={<ArrowRight size={13} />}
      />
      <span className="mx-0.5 w-px h-4 bg-border-default" />
      <BtnIcon
        title="셀 병합 (여러 셀 선택 시)"
        onClick={() => editor.chain().focus().mergeCells().run()}
        icon={<Merge size={13} />}
      />
    </div>
  );
}


function BtnIcon({
  title, onClick, icon,
}: { title: string; onClick: () => void; icon: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="w-7 h-7 rounded flex items-center justify-center text-text-secondary hover:bg-bg-secondary hover:text-accent"
    >
      {icon}
    </button>
  );
}
