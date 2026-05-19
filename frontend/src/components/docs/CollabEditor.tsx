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
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { TextStyleWithSize } from "./FontSizeExtension";
import FontFamily from "@tiptap/extension-font-family";
import { Color } from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { HocuspocusProvider, WebSocketStatus } from "@hocuspocus/provider";
import * as Y from "yjs";
import { Wifi, WifiOff, Loader2 } from "lucide-react";
import { api } from "@/lib/api/client";
import { Toolbar } from "./Toolbar";
import "./collab-editor.css";

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
        await api.ensureFreshToken().catch(() => false);
        return localStorage.getItem("access_token") ?? "";
      },
      onStatus: ({ status: s }) => {
        // eslint-disable-next-line no-console
        console.log("[CollabEditor] status", s);
        setStatus(s);
      },
      onSynced: ({ state }) => {
        // eslint-disable-next-line no-console
        console.log("[CollabEditor] synced — initial state received:", state);
      },
      onAuthenticationFailed: ({ reason }) => {
        // eslint-disable-next-line no-console
        console.warn("[CollabEditor] auth failed:", reason);
        setAuthError(reason || "인증 실패");
      },
      onAwarenessChange: ({ states }) => {
        // eslint-disable-next-line no-console
        console.log(
          "[CollabEditor] awareness raw=",
          JSON.stringify(states),
        );
      },
    });

    // CollaborationCaret이 user 정보를 자동으로 awareness에 박지 못하는 경우가 있어
    // provider awareness에 직접 setLocalStateField 호출 (이중 안전망).
    try {
      prov.setAwarenessField("user", {
        name: userName,
        color: userColor(userId),
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[CollabEditor] setAwarenessField 실패", e);
    }

    // 본문 update 진단 — 다른 client의 update를 받는지 확인용
    yDoc.on("update", (_update: Uint8Array, origin: any) => {
      // eslint-disable-next-line no-console
      console.log(
        "[CollabEditor] yDoc update bytes=",
        _update.length,
        "origin=",
        origin?.constructor?.name ?? typeof origin,
      );
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
      // link/underline은 별도 extension으로 제공 (StarterKit는 v3에서 분리)
      StarterKit.configure({ undoRedo: false }),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
      }),
      Image.configure({ inline: false, allowBase64: true }),
      // 텍스트 스타일 — TextStyle base에 fontSize attr 추가 확장
      TextStyleWithSize,
      FontFamily,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      // 표
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({
        placeholder: "여기에 함께 작성해보세요...",
      }),
      // v3: Collaboration은 document + provider 둘 다 받아야 양방향 sync 완성
      Collaboration.configure({
        document: doc,
        provider,
      }),
      CollaborationCaret.configure({
        provider,
        user: {
          name: userName,
          color: userColor(userId),
        },
        // selection range 시각화 OFF (Google Docs 스타일 — caret + 라벨만)
        selectionRender: () => ({ style: "", class: "" }),
      }),
    ],
    editable: canWrite,
    immediatelyRender: false,
    onCreate: ({ editor: e }) => {
      // eslint-disable-next-line no-console
      console.log("[CollabEditor] editor onCreate, editable=", e.isEditable);
    },
    onUpdate: ({ editor: e }) => {
      // eslint-disable-next-line no-console
      console.log("[CollabEditor] editor onUpdate, len=", e.getText().length);
    },
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
      {/* 상태 + 툴바 */}
      <div className="border-b border-border-default px-3 py-1.5 flex items-center gap-3 bg-bg-secondary">
        <StatusBadge status={status} />
        {!canWrite && (
          <span className="text-caption text-text-tertiary">읽기 전용</span>
        )}
      </div>
      {canWrite && <Toolbar editor={editor} />}
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


// Toolbar는 ./Toolbar.tsx에서 임포트 — Google Docs 스타일 그룹화 버전.
