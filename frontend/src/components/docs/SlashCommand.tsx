"use client";

/**
 * 노션식 슬래시 명령 메뉴 — TipTap Extension + React floating popup.
 *
 * 동작:
 *   - editor 안에서 `/` 입력 → cursor 위치 옆에 floating 메뉴.
 *   - 사용자가 `/headi` 처럼 타이핑하면 메뉴 항목 검색.
 *   - 위/아래 키 + Enter로 선택. Esc/공백/click 외부로 닫힘.
 *   - 선택 시 cursor 앞의 `/<query>` 텍스트를 지우고 명령 실행.
 *
 * 한국어 IME에서도 안정적으로 작동 (마크다운 단축어 `### ` 대안).
 *
 * 사용:
 *   const slash = useSlashCommand({ items: SLASH_ITEMS });
 *   const editor = useEditor({ extensions: [..., slash.extension] });
 *   <SlashMenu state={slash} editor={editor} />
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Editor, Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "prosemirror-state";
import {
  Heading1, Heading2, Heading3, List, ListOrdered, Quote, Code, Minus,
  Table as TableIcon, Type,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface SlashItem {
  key: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  aliases?: string[];
  command: (editor: Editor) => void;
}

interface SlashState {
  active: boolean;
  query: string;
  // range to delete (the typed `/<query>`)
  from: number;
  to: number;
  // floating menu coords (page-relative)
  left: number;
  top: number;
}

const INITIAL_STATE: SlashState = {
  active: false,
  query: "",
  from: 0,
  to: 0,
  left: 0,
  top: 0,
};

interface UseSlashOptions {
  items: SlashItem[];
}

export function useSlashCommand({ items }: UseSlashOptions) {
  const [state, setState] = useState<SlashState>(INITIAL_STATE);

  // Extension은 컴포넌트 lifecycle 동안 안정적으로 유지 (useMemo 대체 ref)
  const extension = useExtensionMemo(() => createSlashExtension());

  // ProseMirror plugin이 호출할 callback을 매 렌더 시 최신 setState로 갱신
  extension.options.onUpdate = (s: Partial<SlashState>) => {
    setState((prev) => ({ ...prev, ...s }));
  };

  const close = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  return { state, items, close, extension };
}


/* ────────────────────────────────────────────────────────────────────────
   메뉴 컴포넌트 (floating popup)
   ──────────────────────────────────────────────────────────────────────── */

interface SlashMenuProps {
  state: SlashState;
  items: SlashItem[];
  editor: Editor | null;
  onClose: () => void;
}

export function SlashMenu({ state, items, editor, onClose }: SlashMenuProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = items.filter((it) => {
    if (!state.query) return true;
    const q = state.query.toLowerCase();
    return (
      it.label.toLowerCase().includes(q) ||
      it.key.toLowerCase().includes(q) ||
      (it.aliases || []).some((a) => a.toLowerCase().includes(q))
    );
  });

  // 활성 idx 보정
  useEffect(() => {
    setActiveIdx(0);
  }, [state.query, state.active]);

  // 키보드 네비게이션
  useEffect(() => {
    if (!state.active || !editor) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = filtered[activeIdx];
        if (item) {
          execute(item);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    const dom = editor.view.dom as HTMLElement;
    dom.addEventListener("keydown", handler, true); // capture phase — TipTap보다 먼저
    return () => dom.removeEventListener("keydown", handler, true);
  }, [state.active, filtered, activeIdx, editor]);

  // 외부 클릭 닫기
  useEffect(() => {
    if (!state.active) return;
    const handler = (e: MouseEvent) => {
      if (listRef.current && !listRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [state.active]);

  // 활성 항목 스크롤
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLButtonElement>(
      `[data-slash-idx="${activeIdx}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  if (!state.active || !editor) return null;

  const execute = (item: SlashItem) => {
    // `/<query>` 텍스트 삭제 후 명령 실행
    const { from, to } = state;
    editor.chain().focus().deleteRange({ from, to }).run();
    item.command(editor);
    onClose();
  };

  // 화면 밖으로 안 나가게 보정 (오른쪽/아래)
  const MENU_W = 280;
  const MENU_H = 320;
  const left = Math.min(
    state.left,
    typeof window !== "undefined" ? window.innerWidth - MENU_W - 8 : state.left,
  );
  const top = Math.min(
    state.top,
    typeof window !== "undefined" ? window.innerHeight - MENU_H - 8 : state.top,
  );

  return (
    <div
      ref={listRef}
      className="fixed z-50 w-[280px] max-h-[320px] overflow-y-auto bg-white border border-[#e8eaed] rounded-lg shadow-lg py-1.5"
      style={{ left, top }}
    >
      {filtered.length === 0 ? (
        <div className="px-3 py-2 text-caption text-text-tertiary">
          일치하는 명령 없음
        </div>
      ) : (
        filtered.map((item, idx) => {
          const Icon = item.icon;
          const active = idx === activeIdx;
          return (
            <button
              key={item.key}
              data-slash-idx={idx}
              onMouseDown={(e) => {
                e.preventDefault(); // editor blur 방지
                execute(item);
              }}
              onMouseEnter={() => setActiveIdx(idx)}
              className={`w-full text-left flex items-center gap-3 px-3 py-2 ${
                active ? "bg-[#f3e5f5]" : "hover:bg-bg-secondary"
              }`}
            >
              <div className={`w-9 h-9 rounded flex items-center justify-center flex-shrink-0 ${
                active ? "bg-white border border-[#673ab7] text-[#673ab7]" : "bg-bg-secondary text-text-secondary"
              }`}>
                <Icon size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-body text-text-primary truncate">{item.label}</div>
                {item.hint && (
                  <div className="text-[11px] text-text-tertiary truncate">{item.hint}</div>
                )}
              </div>
            </button>
          );
        })
      )}
    </div>
  );
}


/* ────────────────────────────────────────────────────────────────────────
   TipTap Extension — ProseMirror plugin으로 `/` 입력 감지
   ──────────────────────────────────────────────────────────────────────── */

interface SlashExtensionOptions {
  onUpdate: (s: Partial<SlashState>) => void;
}

function createSlashExtension() {
  return Extension.create<SlashExtensionOptions>({
    name: "slashCommand",
    addOptions() {
      return {
        onUpdate: () => {},
      };
    },
    addProseMirrorPlugins() {
      const ext = this;
      return [
        new Plugin({
          key: new PluginKey("slashCommand"),
          view() {
            let prevActive = false;
            return {
              update(view) {
                const opts = ext.options;
                const { state } = view;
                const { selection } = state;
                if (!selection.empty) {
                  if (prevActive) {
                    prevActive = false;
                    opts.onUpdate({ active: false });
                  }
                  return;
                }
                const $from = selection.$from;
                // 현재 textblock의 시작 ~ cursor 까지 텍스트
                const blockStart = $from.before();
                const beforeText = state.doc.textBetween(
                  blockStart,
                  $from.pos,
                  "\n",
                  "\n",
                );
                // 줄의 시작 또는 공백 뒤의 `/<word>` 매칭
                const match = beforeText.match(/(?:^|\s)(\/(\S*))$/);
                if (match) {
                  const matchStr = match[1]; // `/query`
                  const from = $from.pos - matchStr.length;
                  const to = $from.pos;
                  const coords = view.coordsAtPos(from);
                  prevActive = true;
                  opts.onUpdate({
                    active: true,
                    query: match[2] || "",
                    from,
                    to,
                    left: coords.left,
                    top: coords.bottom + 4,
                  });
                } else if (prevActive) {
                  prevActive = false;
                  opts.onUpdate({ active: false });
                }
              },
            };
          },
        }),
      ];
    },
  });
}


/* ────────────────────────────────────────────────────────────────────────
   기본 명령 카탈로그
   ──────────────────────────────────────────────────────────────────────── */

export const SLASH_ITEMS: SlashItem[] = [
  {
    key: "h1",
    label: "제목 1",
    hint: "큰 섹션 제목",
    icon: Heading1,
    aliases: ["heading1", "title", "h1", "제목"],
    command: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    key: "h2",
    label: "제목 2",
    hint: "중간 섹션",
    icon: Heading2,
    aliases: ["heading2", "h2"],
    command: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    key: "h3",
    label: "제목 3",
    hint: "작은 섹션",
    icon: Heading3,
    aliases: ["heading3", "h3"],
    command: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    key: "p",
    label: "본문",
    hint: "일반 단락",
    icon: Type,
    aliases: ["paragraph", "text", "본문", "단락"],
    command: (e) => e.chain().focus().setParagraph().run(),
  },
  {
    key: "ul",
    label: "글머리 목록",
    hint: "• 점 목록",
    icon: List,
    aliases: ["bullet", "list", "unordered", "목록"],
    command: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    key: "ol",
    label: "번호 목록",
    hint: "1. 번호 목록",
    icon: ListOrdered,
    aliases: ["ordered", "numbered", "번호"],
    command: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    key: "quote",
    label: "인용구",
    hint: "> 인용",
    icon: Quote,
    aliases: ["blockquote", "인용"],
    command: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    key: "code",
    label: "코드 블록",
    hint: "```code```",
    icon: Code,
    aliases: ["codeblock", "code", "코드"],
    command: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
  {
    key: "hr",
    label: "구분선",
    hint: "수평선",
    icon: Minus,
    aliases: ["horizontalrule", "divider", "hr", "구분"],
    command: (e) => e.chain().focus().setHorizontalRule().run(),
  },
  {
    key: "table",
    label: "표 3×3",
    hint: "테이블 삽입",
    icon: TableIcon,
    aliases: ["table", "표"],
    command: (e) =>
      e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
];


/* ────────────────────────────────────────────────────────────────────────
   useExtensionMemo — extension 객체를 한 번만 생성 (StrictMode 대응)
   ──────────────────────────────────────────────────────────────────────── */

function useExtensionMemo<T>(factory: () => T): T {
  const ref = useRef<T | null>(null);
  if (ref.current === null) {
    ref.current = factory();
  }
  return ref.current;
}
