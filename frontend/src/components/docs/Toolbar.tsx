"use client";

/**
 * 협업 문서 툴바 — Google Docs 스타일 그룹 구성.
 *
 *  [Undo/Redo] [Style] [Heading] [B/I/U/S] [Color/Highlight] [Align] [List/Quote] [Link/Image/Table]
 *
 * editor=null인 경우 read-only / loading 표시.
 */

import { useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  List, ListOrdered, Quote, Heading1, Heading2, Heading3,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Link as LinkIcon, Image as ImageIcon, Table as TableIcon,
  Undo, Redo, Palette, Highlighter, Code, Youtube, Globe,
} from "lucide-react";
import { api } from "@/lib/api/client";

interface ToolbarProps {
  editor: Editor | null;
}

const FONT_OPTIONS: { label: string; value: string }[] = [
  { label: "본문 (기본)", value: "" },
  { label: "본명조", value: "ui-serif, 'Noto Serif KR', serif" },
  { label: "고딕", value: "ui-sans-serif, 'Noto Sans KR', sans-serif" },
  { label: "모노스페이스", value: "ui-monospace, 'Cascadia Mono', monospace" },
];

const SIZE_OPTIONS: { label: string; value: string }[] = [
  { label: "기본", value: "" },
  { label: "10", value: "10px" },
  { label: "12", value: "12px" },
  { label: "14", value: "14px" },
  { label: "16", value: "16px" },
  { label: "18", value: "18px" },
  { label: "20", value: "20px" },
  { label: "24", value: "24px" },
  { label: "32", value: "32px" },
  { label: "48", value: "48px" },
];

const PALETTE = [
  "#000000", "#374151", "#6b7280", "#9ca3af",
  "#dc2626", "#ea580c", "#ca8a04", "#16a34a",
  "#0891b2", "#2563eb", "#7c3aed", "#db2777",
];

export function Toolbar({ editor }: ToolbarProps) {
  const [colorOpen, setColorOpen] = useState<"text" | "highlight" | null>(null);

  if (!editor) {
    return (
      <div className="border-b border-border-default px-3 py-2 text-caption text-text-tertiary">
        편집기 로딩 중...
      </div>
    );
  }

  const Btn = ({
    onClick, active, title, children, disabled,
  }: {
    onClick: () => void; active?: boolean; title: string;
    children: React.ReactNode; disabled?: boolean;
  }) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`p-1.5 rounded transition disabled:opacity-30 ${
        active ? "bg-accent-light text-accent" : "text-text-secondary hover:bg-bg-secondary"
      }`}
    >
      {children}
    </button>
  );

  const Sep = () => <div className="w-px h-5 bg-border-default mx-1" />;

  const promptLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("링크 URL (빈 값으로 두면 해제):", prev || "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  const promptImage = () => {
    const url = window.prompt("이미지 URL:");
    if (!url) return;
    editor.chain().focus().setImage({ src: url }).run();
  };

  const insertTable = () => {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  };

  const promptYouTube = () => {
    const url = window.prompt("YouTube URL (또는 video ID):", "https://www.youtube.com/watch?v=...");
    if (!url) return;
    // TipTap의 setYoutubeVideo는 다양한 URL 형식 자동 처리
    const cmd = editor.chain().focus() as any;
    if (cmd.setYoutubeVideo) {
      cmd.setYoutubeVideo({ src: url, width: 640, height: 360 }).run();
    } else {
      alert("YouTube 확장이 로드되지 않았습니다");
    }
  };

  const promptLinkCard = async () => {
    const url = window.prompt("링크 URL (미리보기 카드로 삽입):", "https://");
    if (!url) return;
    try {
      // OG 미리보기 fetch (안전: backend가 SSRF 차단)
      const meta = await api.get<{
        title?: string; description?: string; image?: string;
        site_name?: string; url?: string;
      }>(`/api/embeds/og-preview?url=${encodeURIComponent(url)}`);
      const cmd = editor.chain().focus() as any;
      if (cmd.setLinkCard) {
        cmd.setLinkCard({
          url: meta.url || url,
          title: meta.title || url,
          description: meta.description || "",
          image: meta.image || "",
          site_name: meta.site_name || "",
        }).run();
      } else {
        editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
      }
    } catch (e: any) {
      // 미리보기 실패 — 일반 링크로 fallback
      // eslint-disable-next-line no-console
      console.warn("OG fetch failed, fallback to plain link:", e);
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
  };

  return (
    <div className="border-b border-border-default px-3 py-2 flex items-center gap-0.5 bg-bg-secondary flex-wrap">
      {/* Undo / Redo */}
      <Btn onClick={() => editor.chain().focus().undo().run()} title="실행 취소 (Ctrl+Z)">
        <Undo size={14} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().redo().run()} title="다시 실행 (Ctrl+Shift+Z)">
        <Redo size={14} />
      </Btn>
      <Sep />

      {/* 폰트 */}
      <select
        value={(editor.getAttributes("textStyle").fontFamily as string) || ""}
        onChange={(e) => {
          const v = e.target.value;
          if (v) editor.chain().focus().setFontFamily(v).run();
          else editor.chain().focus().unsetFontFamily().run();
        }}
        title="글꼴"
        className="text-caption border border-border-default rounded px-1.5 py-0.5 bg-bg-primary"
      >
        {FONT_OPTIONS.map((f) => (
          <option key={f.label} value={f.value}>{f.label}</option>
        ))}
      </select>
      <select
        value={(editor.getAttributes("textStyle").fontSize as string) || ""}
        onChange={(e) => {
          const v = e.target.value;
          if (v) editor.chain().focus().setFontSize(v).run();
          else editor.chain().focus().unsetFontSize().run();
        }}
        title="글자 크기"
        className="text-caption border border-border-default rounded px-1.5 py-0.5 bg-bg-primary"
      >
        {SIZE_OPTIONS.map((s) => (
          <option key={s.label} value={s.value}>{s.label}</option>
        ))}
      </select>
      <Sep />

      {/* Headings */}
      <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        active={editor.isActive("heading", { level: 1 })} title="제목 1">
        <Heading1 size={14} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        active={editor.isActive("heading", { level: 2 })} title="제목 2">
        <Heading2 size={14} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        active={editor.isActive("heading", { level: 3 })} title="제목 3">
        <Heading3 size={14} />
      </Btn>
      <Sep />

      {/* Text formats */}
      <Btn onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive("bold")} title="굵게 (Ctrl+B)"><Bold size={14} /></Btn>
      <Btn onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive("italic")} title="기울임 (Ctrl+I)"><Italic size={14} /></Btn>
      <Btn onClick={() => editor.chain().focus().toggleUnderline().run()}
        active={editor.isActive("underline")} title="밑줄 (Ctrl+U)"><UnderlineIcon size={14} /></Btn>
      <Btn onClick={() => editor.chain().focus().toggleStrike().run()}
        active={editor.isActive("strike")} title="취소선"><Strikethrough size={14} /></Btn>
      <Btn onClick={() => editor.chain().focus().toggleCode().run()}
        active={editor.isActive("code")} title="인라인 코드"><Code size={14} /></Btn>
      <Sep />

      {/* Color + Highlight */}
      <div className="relative">
        <Btn
          onClick={() => setColorOpen(colorOpen === "text" ? null : "text")}
          title="글자색"
        ><Palette size={14} /></Btn>
        {colorOpen === "text" && (
          <ColorPopover
            onPick={(c) => {
              if (c) editor.chain().focus().setColor(c).run();
              else editor.chain().focus().unsetColor().run();
              setColorOpen(null);
            }}
            onClose={() => setColorOpen(null)}
          />
        )}
      </div>
      <div className="relative">
        <Btn
          onClick={() => setColorOpen(colorOpen === "highlight" ? null : "highlight")}
          title="형광펜"
        ><Highlighter size={14} /></Btn>
        {colorOpen === "highlight" && (
          <ColorPopover
            onPick={(c) => {
              if (c) editor.chain().focus().setHighlight({ color: c + "55" }).run();
              else editor.chain().focus().unsetHighlight().run();
              setColorOpen(null);
            }}
            onClose={() => setColorOpen(null)}
          />
        )}
      </div>
      <Sep />

      {/* Align */}
      <Btn onClick={() => editor.chain().focus().setTextAlign("left").run()}
        active={editor.isActive({ textAlign: "left" })} title="왼쪽 정렬"><AlignLeft size={14} /></Btn>
      <Btn onClick={() => editor.chain().focus().setTextAlign("center").run()}
        active={editor.isActive({ textAlign: "center" })} title="가운데 정렬"><AlignCenter size={14} /></Btn>
      <Btn onClick={() => editor.chain().focus().setTextAlign("right").run()}
        active={editor.isActive({ textAlign: "right" })} title="오른쪽 정렬"><AlignRight size={14} /></Btn>
      <Btn onClick={() => editor.chain().focus().setTextAlign("justify").run()}
        active={editor.isActive({ textAlign: "justify" })} title="양쪽 정렬"><AlignJustify size={14} /></Btn>
      <Sep />

      {/* Lists / Quote */}
      <Btn onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive("bulletList")} title="글머리 기호 목록"><List size={14} /></Btn>
      <Btn onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive("orderedList")} title="번호 매기기 목록"><ListOrdered size={14} /></Btn>
      <Btn onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive("blockquote")} title="인용"><Quote size={14} /></Btn>
      <Sep />

      {/* Link / Image / Table */}
      <Btn onClick={promptLink}
        active={editor.isActive("link")} title="링크 (인라인)"><LinkIcon size={14} /></Btn>
      <Btn onClick={promptLinkCard} title="링크 카드 (OG 미리보기)"><Globe size={14} /></Btn>
      <Btn onClick={promptImage} title="이미지 (URL)"><ImageIcon size={14} /></Btn>
      <Btn onClick={promptYouTube} title="YouTube 임베드"><Youtube size={14} /></Btn>
      <div className="relative inline-flex items-center">
        <Btn onClick={insertTable} title="표 삽입 (3×3)"><TableIcon size={14} /></Btn>
        {editor.isActive("table") && (
          <TableActions editor={editor} />
        )}
      </div>
    </div>
  );
}


/** 색상 팔레트 popover */
function ColorPopover({
  onPick, onClose,
}: { onPick: (color: string | null) => void; onClose: () => void }) {
  return (
    <>
      {/* 바깥 클릭 닫기 */}
      <div
        className="fixed inset-0 z-10"
        onClick={onClose}
      />
      <div className="absolute top-full left-0 mt-1 z-20 bg-bg-primary border border-border-default rounded shadow-lg p-2 grid grid-cols-4 gap-1 w-[120px]">
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onPick(c)}
            className="w-5 h-5 rounded border border-border-default hover:scale-110 transition"
            style={{ backgroundColor: c }}
            aria-label={c}
          />
        ))}
        <button
          type="button"
          onClick={() => onPick(null)}
          className="col-span-4 text-[11px] py-1 border-t border-border-default mt-1 text-text-tertiary hover:text-accent"
        >
          색 제거
        </button>
      </div>
    </>
  );
}


/** 표 안일 때 추가 액션 */
function TableActions({ editor }: { editor: Editor }) {
  const cls = "px-1 py-0.5 text-[10px] border border-border-default rounded bg-bg-primary hover:bg-bg-secondary text-text-secondary";
  return (
    <div className="ml-1 flex items-center gap-0.5">
      <button type="button" onClick={() => editor.chain().focus().addRowAfter().run()}
        title="아래 행 추가" className={cls}>+행</button>
      <button type="button" onClick={() => editor.chain().focus().addColumnAfter().run()}
        title="오른쪽 열 추가" className={cls}>+열</button>
      <button type="button" onClick={() => editor.chain().focus().deleteRow().run()}
        title="현재 행 삭제" className={cls}>−행</button>
      <button type="button" onClick={() => editor.chain().focus().deleteColumn().run()}
        title="현재 열 삭제" className={cls}>−열</button>
      <button type="button" onClick={() => editor.chain().focus().deleteTable().run()}
        title="표 삭제" className={cls + " text-status-error"}>×표</button>
    </div>
  );
}
