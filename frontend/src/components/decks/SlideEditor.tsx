"use client";

/**
 * 단일 슬라이드 본문 편집기 — TipTap × Yjs fragment.
 *
 * 같은 deck Y.Doc / HocuspocusProvider를 부모 (DeckEditor)에서 받아 공유.
 * 각 slide는 fragment 이름 `slide-{sid}` 단위로 분리 — slide별 별도 본문.
 *
 * 사용 (DeckEditor에서):
 *   <SlideEditor
 *     key={slide.id}
 *     doc={yDoc}
 *     provider={provider}
 *     fragmentName={`slide-${slide.id}`}
 *     canWrite={canWrite}
 *     userName={user.name}
 *     userId={user.id}
 *   />
 */

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import Underline from "@tiptap/extension-underline";
import { TextStyleWithSize } from "../docs/FontSizeExtension";
import FontFamily from "@tiptap/extension-font-family";
import { Color } from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Youtube from "@tiptap/extension-youtube";
import { LinkCard } from "../docs/LinkCardExtension";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import { Toolbar } from "../docs/Toolbar";
import { getTheme } from "./themes";
import "../docs/collab-editor.css";

interface SlideEditorProps {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  fragmentName: string;
  canWrite: boolean;
  userName: string;
  userId: number;
  themeId?: string | null;
}

function userColor(userId: number): string {
  const hue = (userId * 137) % 360;
  return `hsl(${hue}, 70%, 50%)`;
}

export function SlideEditor({
  doc, provider, fragmentName, canWrite, userName, userId, themeId,
}: SlideEditorProps) {
  const theme = getTheme(themeId);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
      }),
      Image.configure({ inline: false, allowBase64: true }),
      Youtube.configure({
        controls: true, nocookie: true, allowFullscreen: true, modestBranding: true,
      }),
      LinkCard,
      TextStyleWithSize,
      FontFamily,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({
        placeholder: "슬라이드 내용을 작성하세요...",
      }),
      // 핵심: fragment 옵션으로 slide별 본문 격리
      Collaboration.configure({
        document: doc,
        field: fragmentName,
        provider,
      }),
      CollaborationCaret.configure({
        provider,
        user: { name: userName, color: userColor(userId) },
        selectionRender: () => ({ style: "", class: "" }),
      }),
    ],
    editable: canWrite,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "prose prose-sm sm:prose-base max-w-none focus:outline-none min-h-[400px] " +
          "px-8 py-6",
      },
    },
  }, [canWrite, doc, provider, fragmentName]);

  return (
    <div className="rounded-lg shadow-sm border border-border-default flex flex-col h-full overflow-hidden bg-white">
      {canWrite && <Toolbar editor={editor} />}
      {/* 슬라이드 본문 — theme 적용 */}
      <div className="flex-1 overflow-y-auto" style={theme.slideStyle}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
