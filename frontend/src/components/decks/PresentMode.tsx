"use client";

/**
 * 발표 모드 — 풀스크린 슬라이드 뷰어.
 *
 * - 자체 Yjs 연결로 가장 최신 본문 표시 (read-only)
 * - 좌·우 키 / 클릭으로 슬라이드 전환
 * - ESC로 종료 (parent가 navigate)
 * - F11는 브라우저 풀스크린 (사용자 직접)
 *
 * Reveal.js 등 대신 자체 CSS 풀스크린 사용 — 권한·인증·Yjs 통합이 자연.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { TextStyleWithSize } from "../docs/FontSizeExtension";
import FontFamily from "@tiptap/extension-font-family";
import { Color } from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Collaboration from "@tiptap/extension-collaboration";
import { ChevronLeft, ChevronRight, X, Maximize } from "lucide-react";
import { api } from "@/lib/api/client";
import { getTheme } from "./themes";
import "../docs/collab-editor.css";

const DEFAULT_HOCUSPOCUS_URL =
  process.env.NEXT_PUBLIC_HOCUSPOCUS_URL || "ws://localhost:1234";

interface SlideRef {
  id: number;
  order: number;
  title: string | null;
}

interface PresentModeProps {
  deckId: number;
  deckTitle: string;
  slides: SlideRef[];
  themeId?: string | null;
  onExit: () => void;
  hocuspocusUrl?: string;
}

export function PresentMode({
  deckId, deckTitle, slides, themeId, onExit,
  hocuspocusUrl = DEFAULT_HOCUSPOCUS_URL,
}: PresentModeProps) {
  const theme = getTheme(themeId);
  const [idx, setIdx] = useState(0);
  const active = slides[idx];

  // Y.Doc + provider — read-only 연결
  const { doc, provider } = useMemo(() => {
    const yDoc = new Y.Doc();
    const prov = new HocuspocusProvider({
      url: hocuspocusUrl,
      name: `deck-${deckId}`,
      document: yDoc,
      async token() {
        await api.ensureFreshToken().catch(() => false);
        return localStorage.getItem("access_token") ?? "";
      },
    });
    return { doc: yDoc, provider: prov };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId, hocuspocusUrl]);

  useEffect(() => {
    return () => {
      try { provider.destroy(); } catch {}
      try { doc.destroy(); } catch {}
    };
  }, [doc, provider]);

  // 키보드: 좌·우 / Space / Esc / 1~9
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        setIdx((i) => Math.min(slides.length - 1, i + 1));
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        setIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "Escape") {
        onExit();
      } else if (e.key === "Home") {
        setIdx(0);
      } else if (e.key === "End") {
        setIdx(slides.length - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slides.length, onExit]);

  const requestFullscreen = useCallback(() => {
    document.documentElement.requestFullscreen?.().catch(() => {});
  }, []);

  if (!active) {
    return (
      <div className="fixed inset-0 z-50 bg-black text-white flex items-center justify-center">
        <div>슬라이드 없음</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#1a1a1a] text-white flex flex-col">
      {/* 상단 바 (작게) */}
      <div className="px-4 py-2 flex items-center justify-between text-caption text-white/60">
        <div className="truncate">{deckTitle}</div>
        <div className="flex items-center gap-3">
          <span>{idx + 1} / {slides.length}</span>
          <button
            onClick={requestFullscreen}
            className="p-1 hover:bg-white/10 rounded"
            title="전체 화면 (F11과 동일)"
          >
            <Maximize size={14} />
          </button>
          <button
            onClick={onExit}
            className="p-1 hover:bg-white/10 rounded"
            title="종료 (Esc)"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* 슬라이드 본문 — 16:9 비율 고정 */}
      <div className="flex-1 flex items-center justify-center p-4 relative">
        <button
          onClick={() => setIdx((i) => Math.max(0, i - 1))}
          disabled={idx === 0}
          className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronLeft size={20} />
        </button>

        <div
          className="rounded shadow-2xl overflow-hidden"
          style={{
            ...theme.slideStyle,
            aspectRatio: "16/9",
            width: "min(90vw, calc(90vh * 16/9))",
            maxHeight: "90vh",
          }}
        >
          <PresentSlide
            key={active.id}
            doc={doc}
            provider={provider}
            fragmentName={`slide-${active.id}`}
          />
        </div>

        <button
          onClick={() => setIdx((i) => Math.min(slides.length - 1, i + 1))}
          disabled={idx === slides.length - 1}
          className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {/* 하단 네비 */}
      <div className="px-4 py-2 text-[11px] text-white/40 text-center">
        ← / → 슬라이드 전환 · Space 다음 · Esc 종료 · F11 전체화면
      </div>
    </div>
  );
}

function PresentSlide({
  doc, provider, fragmentName,
}: {
  doc: Y.Doc; provider: HocuspocusProvider; fragmentName: string;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Underline,
      Link.configure({ openOnClick: true, autolink: false }),
      Image.configure({ inline: false, allowBase64: true }),
      TextStyleWithSize,
      FontFamily,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Collaboration.configure({
        document: doc,
        field: fragmentName,
        provider,
      }),
    ],
    editable: false,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "prose prose-lg max-w-none focus:outline-none " +
          "h-full px-12 py-10",
      },
    },
  }, [doc, provider, fragmentName]);

  return (
    <div className="h-full w-full">
      <EditorContent editor={editor} />
    </div>
  );
}
