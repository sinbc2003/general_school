"use client";

/**
 * 학생용 단독 협업 문서 편집기 — course_id 없는 문서용.
 *
 * /s/classroom/[cid]/docs/[did] 와 동일 CollabEditor + ShareDocModal 재사용.
 * 다른 점: 강좌 컨텍스트 없음 → 헤더에 "내 문서로" 링크.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Share2, Sparkles, ExternalLink } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAuth } from "@/lib/auth-context";
import CollabEditor from "@/components/docs/CollabEditor";
import { ShareDocModal } from "@/components/classroom/ShareDocModal";
import { AIAssistantPanel } from "@/components/tool-ai/AIAssistantPanel";
import type { ApplyHandler } from "@/components/tool-ai/types";
import { EditableTitle } from "@/components/ui/EditableTitle";
import type { Editor } from "@tiptap/react";
import { marked } from "marked";

interface Permission {
  can_read: boolean;
  can_write: boolean;
  can_share: boolean;
  role: string | null;
}

interface DocDetail {
  id: number;
  course_id: number | null;
  owner_id: number;
  owner_name?: string;
  title: string;
  access_mode: string;
  is_archived: boolean;
  updated_at: string | null;
  permission: Permission;
}

export default function StudentStandaloneDocPage() {
  const params = useParams();
  const router = useRouter();
  const { user, hasPermission } = useAuth();
  const did = Number(params.did);

  const [doc, setDoc] = useState<DocDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showShare, setShowShare] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const editorRef = useRef<Editor | null>(null);
  const canUseAI = hasPermission("tool.ai_assistant.use");

  const aiApply: ApplyHandler = async (call) => {
    const editor = editorRef.current;
    if (!editor) return;
    if (call.name === "doc_append_markdown") {
      const html = await marked.parse(String(call.arguments.markdown || ""));
      editor.chain().focus("end").insertContent(html as string).run();
    } else if (call.name === "doc_replace_all") {
      const html = await marked.parse(String(call.arguments.markdown || ""));
      editor.chain().focus().setContent(html as string, { emitUpdate: true }).run();
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get<DocDetail>(`/api/classroom/docs/${did}`);
      setDoc(d);
    } catch (e: any) {
      alert(e?.detail || "문서 조회 실패");
      router.push("/s/docs");
    } finally {
      setLoading(false);
    }
  }, [did, router]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="text-text-tertiary">로딩 중...</div>;
  if (!doc) return null;

  const accessLabel: Record<string, string> = {
    course_members: "강좌 멤버",
    specific_users: "지정 사용자",
    link_public: "링크 공유",
  };

  return (
    <div className="w-full">
      <div className="mb-3">
        <Link
          href="/s/drive"
          className="text-caption text-text-tertiary hover:text-accent inline-flex items-center gap-1"
        >
          <ArrowLeft size={12} /> 내 드라이브
        </Link>
      </div>

      <div className="mb-2">
        <EditableTitle
          value={doc.title}
          canEdit={doc.permission.can_write && !doc.is_archived}
          onSave={async (next) => {
            try {
              await api.put(`/api/classroom/docs/${did}`, { title: next });
              await load();
            } catch (e: any) {
              alert(e?.detail || "제목 저장 실패");
            }
          }}
        />
      </div>

      <div className="text-caption text-text-tertiary mb-4 flex items-center gap-3 flex-wrap">
        <span>
          만든이 <b>{doc.owner_name || `#${doc.owner_id}`}</b>
        </span>
        <button
          onClick={() => setShowShare(true)}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-bg-secondary"
          title="공유 정보"
        >
          <Share2 size={11} /> {accessLabel[doc.access_mode] || doc.access_mode}
        </button>
        <span>수정 {doc.updated_at?.slice(0, 16).replace("T", " ")}</span>
        <span className="ml-auto">
          내 권한: <b className="text-accent">{doc.permission.role || "없음"}</b>
          {!doc.permission.can_write && " (읽기 전용)"}
        </span>
        <button
          onClick={() => window.open(`/embed/docs/${did}`, "_blank", "noopener,noreferrer")}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11.5px] text-text-tertiary border border-border-default rounded hover:bg-bg-secondary"
          title="새 창에서 열기"
        >
          <ExternalLink size={11} /> 새 창
        </button>
        {canUseAI && doc.permission.can_write && !doc.is_archived && (
          <button
            onClick={() => setShowAI(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11.5px] text-[#673ab7] border border-[#e8def8] rounded hover:bg-[#f3e5f5]"
            title="AI 도우미"
          >
            <Sparkles size={11} /> AI
          </button>
        )}
      </div>

      {user ? (
        <CollabEditor
          docId={did}
          userId={user.id}
          userName={user.name}
          canWrite={doc.permission.can_write && !doc.is_archived}
          onEditorReady={(e) => { editorRef.current = e; }}
        />
      ) : (
        <div className="border border-border-default rounded-lg p-8 text-center text-text-tertiary">
          사용자 정보 로딩 중...
        </div>
      )}

      {canUseAI && (
        <AIAssistantPanel
          toolKind="doc"
          toolId={did}
          applyHandler={aiApply}
          getCurrentContent={() => editorRef.current ? editorRef.current.getText() : ""}
          open={showAI}
          onClose={() => setShowAI(false)}
        />
      )}

      {showShare && (
        <ShareDocModal
          docId={did}
          docTitle={doc.title}
          ownerId={doc.owner_id}
          canShare={doc.permission.can_share}
          currentAccessMode={doc.access_mode as any}
          onClose={() => setShowShare(false)}
          onChanged={load}
        />
      )}
    </div>
  );
}
