"use client";

/**
 * 단일 슬라이드 본문 편집기 — TipTap × Yjs fragment.
 *
 * 디자인 — Google Slides 스타일 편집 캔버스:
 *   ┌──────────────────────────────┐
 *   │  Toolbar (canWrite 시)       │
 *   ├──────────────────────────────┤
 *   │  [회색 스테이지 배경]         │
 *   │   ┌─────────────────────┐    │
 *   │   │ 16:9 slide canvas   │    │
 *   │   │ (theme.slideStyle)   │    │
 *   │   │  본문 + caret       │    │
 *   │   └─────────────────────┘    │
 *   └──────────────────────────────┘
 *
 * 캔버스는 컨테이너 폭에 맞춰 자동 크기, 16:9 비율 고정 (PresentMode와 일관).
 * 슬라이드 본문은 큰 폰트·중앙 정렬 기조 — 슬라이드답게.
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
 *     themeId={themeId}
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
import "./slide-canvas.css";

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
        placeholder: "제목 또는 본문을 입력하세요",
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
        // 슬라이드 본문 — prose 기반, slide-canvas.css에서 폰트 사이즈 키움
        class: "slide-prose focus:outline-none w-full h-full",
      },
    },
  }, [canWrite, doc, provider, fragmentName]);

  return (
    <div className="rounded-lg shadow-sm border border-border-default flex flex-col h-full overflow-hidden bg-white">
      {canWrite && <Toolbar editor={editor} />}

      {/* 회색 스테이지 — Google Slides 식 빈 캔버스 주변 영역.
          container-type: size로 cqw/cqh 사용 가능. */}
      <div className="slide-stage flex-1 overflow-auto bg-[#f1f3f4] flex items-center justify-center">
        {/* 16:9 슬라이드 캔버스 — 컨테이너 폭/높이 중 작은 쪽에 맞춤 (1100px 상한) */}
        <div
          className="slide-canvas shadow-xl rounded overflow-hidden relative"
          style={theme.slideStyle}
        >
          {/* 본문 — 캔버스 내부 padding은 slide-canvas.css가 처리 */}
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
