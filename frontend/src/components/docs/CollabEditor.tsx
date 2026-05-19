"use client";

/**
 * 협업 문서 편집기 — TipTap + Yjs + Hocuspocus.
 *
 * - 같은 docId에 접속한 사용자들의 편집을 CRDT로 자동 merge
 * - 다른 사용자의 커서·선택 영역 표시 (presence)
 * - 권한이 read-only면 readOnly 모드로 표시 (서버에서도 다시 차단됨)
 * - 인증 실패/연결 끊김 처리
 *
 * 사용:
 *   <CollabEditor docId={42} userName="신병철" userId={123} canWrite={true} />
 *
 * 환경변수:
 *   NEXT_PUBLIC_HOCUSPOCUS_URL — dev: ws://localhost:1234 (기본)
 *     prod: wss://school.example.com/yjs 같은 reverse-proxy URL
 */

import { useEffect, useMemo, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { HocuspocusProvider, WebSocketStatus } from "@hocuspocus/provider";
import * as Y from "yjs";
import {
  Bold, Italic, List, ListOrdered, Heading1, Heading2, Quote,
  Undo, Redo, Wifi, WifiOff, Loader2,
} from "lucide-react";
import { api } from "@/lib/api/client";

interface CollabEditorProps {
  docId: number;
  userId: number;
  userName: string;
  canWrite: boolean;
  /** dev 기본은 ws://localhost:1234. production은 NEXT_PUBLIC_HOCUSPOCUS_URL. */
  hocuspocusUrl?: string;
}

const DEFAULT_HOCUSPOCUS_URL =
  process.env.NEXT_PUBLIC_HOCUSPOCUS_URL || "ws://localhost:1234";

/** 사용자 ID에서 안정적인 HSL 색상 생성 (커서 색). */
function userColor(userId: number): string {
  const hue = (userId * 137) % 360; // 황금각으로 분산
  return `hsl(${hue}, 70%, 50%)`;
}

export default function CollabEditor({
  docId, userId, userName, canWrite,
  hocuspocusUrl = DEFAULT_HOCUSPOCUS_URL,
}: CollabEditorProps) {
  const [status, setStatus] = useState<WebSocketStatus>(WebSocketStatus.Connecting);
  const [authError, setAuthError] = useState<string | null>(null);

  // Y.Doc + HocuspocusProvider — docId 단위로 한 번만 생성 (useMemo)
  // token은 함수로 전달 → 매 (재)연결 시점에 fresh access_token 반환.
  // access_token 만료(15분) 이전이면 그대로, 만료 시 refresh_token으로 갱신 후 반환.
  const { doc, provider } = useMemo(() => {
    const yDoc = new Y.Doc();

    const prov = new HocuspocusProvider({
      url: hocuspocusUrl,
      name: `doc-${docId}`,
      document: yDoc,
      async token() {
        // 매 연결마다 refresh 시도 (refresh_token이 살아있으면 새 access_token 발급).
        // 실패해도 진행 — 기존 access_token이 아직 유효할 수 있음.
        await api.ensureFreshToken().catch(() => false);
        return localStorage.getItem("access_token") ?? "";
      },
      onStatus: ({ status: s }) => setStatus(s),
      onAuthenticationFailed: ({ reason }) => {
        setAuthError(reason || "인증 실패");
      },
    });

    return { doc: yDoc, provider: prov };
    // hocuspocusUrl/docId가 바뀌면 새 provider 생성
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, hocuspocusUrl]);

  // 14분마다 access_token 백그라운드 갱신 — long session 동안 만료 방지.
  // (access_token 기본 15분 만료. 만료 후 재연결 시 token() 함수가 다시 refresh하지만,
  //  active connection은 끊지 않도록 사전 갱신.)
  useEffect(() => {
    const id = setInterval(() => {
      api.ensureFreshToken().catch(() => undefined);
    }, 14 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // 언마운트 시 정리
  useEffect(() => {
    return () => {
      provider.destroy();
      doc.destroy();
    };
  }, [doc, provider]);

  const editor = useEditor({
    extensions: [
      // StarterKit의 undoRedo는 Yjs와 충돌 → 비활성화 (Yjs collaboration이 자체 undo 제공)
      StarterKit.configure({ undoRedo: false }),
      Placeholder.configure({
        placeholder: "여기에 함께 작성해보세요...",
      }),
      Collaboration.configure({ document: doc }),
      CollaborationCaret.configure({
        provider,
        user: {
          name: userName,
          color: userColor(userId),
        },
      }),
    ],
    editable: canWrite,
    // SSR/Next.js 14 호환
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "prose prose-sm sm:prose-base max-w-none focus:outline-none min-h-[400px] " +
          "px-6 py-4",
      },
    },
  }, [canWrite, doc, provider]);

  if (authError) {
    return (
      <div className="border border-status-error bg-red-50 rounded-lg p-6 text-center">
        <div className="text-status-error font-medium mb-2">협업 서버 인증 실패</div>
        <div className="text-caption text-text-secondary mb-4">{authError}</div>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover"
        >
          페이지 새로고침
        </button>
      </div>
    );
  }

  return (
    <div className="border border-border-default rounded-lg bg-bg-primary overflow-hidden">
      {/* 상태 표시 + 툴바 */}
      <div className="border-b border-border-default px-3 py-2 flex items-center gap-2 bg-bg-secondary">
        <StatusBadge status={status} />
        <div className="w-px h-4 bg-border-default" />
        {canWrite && editor ? <Toolbar editor={editor} /> : (
          <span className="text-caption text-text-tertiary">읽기 전용</span>
        )}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}


function StatusBadge({ status }: { status: WebSocketStatus }) {
  if (status === WebSocketStatus.Connected) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-status-success">
        <Wifi size={11} /> 동기화 중
      </span>
    );
  }
  if (status === WebSocketStatus.Connecting) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-text-tertiary">
        <Loader2 size={11} className="animate-spin" /> 연결 중...
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-status-warning">
      <WifiOff size={11} /> 연결 끊김 (재시도)
    </span>
  );
}


function Toolbar({ editor }: { editor: Editor }) {
  const Btn = ({
    onClick, active, title, children,
  }: { onClick: () => void; active?: boolean; title: string; children: React.ReactNode }) => (
    <button
      onClick={onClick}
      title={title}
      className={`p-1 rounded hover:bg-bg-primary transition ${
        active ? "bg-accent-light text-accent" : "text-text-secondary"
      }`}
    >
      {children}
    </button>
  );

  return (
    <div className="flex items-center gap-0.5 flex-1">
      <Btn
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive("bold")}
        title="굵게 (Ctrl+B)"
      ><Bold size={14} /></Btn>
      <Btn
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive("italic")}
        title="기울임 (Ctrl+I)"
      ><Italic size={14} /></Btn>
      <div className="w-px h-4 bg-border-default mx-1" />
      <Btn
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        active={editor.isActive("heading", { level: 1 })}
        title="제목 1"
      ><Heading1 size={14} /></Btn>
      <Btn
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        active={editor.isActive("heading", { level: 2 })}
        title="제목 2"
      ><Heading2 size={14} /></Btn>
      <div className="w-px h-4 bg-border-default mx-1" />
      <Btn
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive("bulletList")}
        title="글머리 기호 목록"
      ><List size={14} /></Btn>
      <Btn
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive("orderedList")}
        title="번호 매기기 목록"
      ><ListOrdered size={14} /></Btn>
      <Btn
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive("blockquote")}
        title="인용"
      ><Quote size={14} /></Btn>
      {/* Yjs collaboration이 자체 undo/redo 제공 */}
      <div className="ml-auto flex items-center gap-0.5">
        <Btn
          onClick={() => editor.chain().focus().undo().run()}
          title="실행 취소 (Ctrl+Z)"
        ><Undo size={14} /></Btn>
        <Btn
          onClick={() => editor.chain().focus().redo().run()}
          title="다시 실행 (Ctrl+Shift+Z)"
        ><Redo size={14} /></Btn>
      </div>
    </div>
  );
}
