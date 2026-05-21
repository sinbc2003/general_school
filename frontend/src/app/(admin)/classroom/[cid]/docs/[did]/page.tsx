"use client";

/**
 * 협업 문서 편집기 placeholder (관리자·교사·학생 공용).
 *
 * Phase A+B-1: 메타 표시 + 빈 편집기 슬롯만.
 * Phase A+B-4 에서 CollabEditor (TipTap + Yjs + Hocuspocus) 컴포넌트로 교체.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Save, Share2, Archive, Trash2, Sparkles, ExternalLink } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAuth } from "@/lib/auth-context";
import CollabEditor from "@/components/docs/CollabEditor";
import { ShareDocModal } from "@/components/classroom/ShareDocModal";
import { AIAssistantPanel } from "@/components/tool-ai/AIAssistantPanel";
import type { ApplyHandler } from "@/components/tool-ai/types";
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
  created_at: string | null;
  updated_at: string | null;
  permission: Permission;
}

export default function CourseDocEditorPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const cid = Number(params.cid);
  const did = Number(params.did);

  const [doc, setDoc] = useState<DocDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [savingTitle, setSavingTitle] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const editorRef = useRef<Editor | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get<DocDetail>(`/api/classroom/docs/${did}`);
      setDoc(d);
      setTitle(d.title);
    } catch (e: any) {
      alert(e?.detail || "문서 조회 실패");
      router.push(`/classroom/${cid}/docs`);
    } finally {
      setLoading(false);
    }
  }, [cid, did, router]);

  useEffect(() => { load(); }, [load]);

  const saveTitle = async () => {
    if (!title.trim() || !doc) return;
    if (title === doc.title) return;
    setSavingTitle(true);
    try {
      await api.put(`/api/classroom/docs/${did}`, { title: title.trim() });
      await load();
    } catch (e: any) {
      alert(e?.detail || "제목 저장 실패");
    } finally {
      setSavingTitle(false);
    }
  };

  const toggleArchive = async () => {
    if (!doc) return;
    if (!confirm(doc.is_archived ? "보관 해제하시겠습니까?" : "이 문서를 보관 처리합니까?")) return;
    try {
      await api.put(`/api/classroom/docs/${did}`, { is_archived: !doc.is_archived });
      await load();
    } catch (e: any) {
      alert(e?.detail || "변경 실패");
    }
  };

  const aiApply: ApplyHandler = async (call) => {
    const editor = editorRef.current;
    if (!editor) {
      alert("편집기가 아직 준비되지 않았습니다.");
      return;
    }
    if (call.name === "doc_append_markdown") {
      const md = String(call.arguments.markdown || "");
      const html = await marked.parse(md);
      // 본문 끝으로 이동 후 삽입
      editor.chain().focus("end").insertContent(html as string).run();
    } else if (call.name === "doc_replace_all") {
      const md = String(call.arguments.markdown || "");
      const html = await marked.parse(md);
      editor.chain().focus().setContent(html as string, { emitUpdate: true }).run();
    }
  };

  const deleteDoc = async () => {
    if (!confirm("이 문서를 삭제합니다. 복구할 수 없습니다.")) return;
    try {
      await api.delete(`/api/classroom/docs/${did}`);
      router.push(`/classroom/${cid}/docs`);
    } catch (e: any) {
      alert(e?.detail || "삭제 실패");
    }
  };

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
          href="/drive"
          className="text-caption text-text-tertiary hover:text-accent inline-flex items-center gap-1"
        >
          <ArrowLeft size={12} /> 내 드라이브
        </Link>
      </div>

      {/* 제목 + 메타 + 액션 */}
      <div className="flex items-center gap-2 mb-3">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          disabled={!doc.permission.can_write || doc.is_archived}
          className="flex-1 text-title font-semibold bg-transparent border-0 outline-none focus:bg-bg-secondary px-2 py-1 rounded disabled:text-text-tertiary"
          placeholder="제목 없음"
        />
        {savingTitle && <Save size={14} className="text-text-tertiary animate-pulse" />}
        <button
          onClick={() => window.open(`/embed/docs/${did}`, "_blank", "noopener,noreferrer")}
          title="새 창에서 열기 (사이드바 없이 문서만 표시)"
          className="p-1.5 text-text-tertiary hover:text-accent hover:bg-bg-secondary rounded"
        >
          <ExternalLink size={16} />
        </button>
        {doc.permission.can_write && !doc.is_archived && (
          <button
            onClick={() => setShowAI(true)}
            title="AI 도우미 (수업안·가정통신문 등 자동 생성)"
            className="p-1.5 text-[#673ab7] hover:bg-[#f3e5f5] rounded"
          >
            <Sparkles size={16} />
          </button>
        )}
        {doc.permission.can_share && (
          <>
            <button
              onClick={() => setShowShare(true)}
              title="단축 링크 + QR 공유"
              className="p-1.5 text-text-tertiary hover:text-accent rounded"
            >
              <Share2 size={16} />
            </button>
            <button
              onClick={toggleArchive}
              title={doc.is_archived ? "보관 해제" : "보관 처리"}
              className="p-1.5 text-text-tertiary hover:text-accent rounded"
            >
              <Archive size={16} />
            </button>
            <button
              onClick={deleteDoc}
              title="삭제"
              className="p-1.5 text-text-tertiary hover:text-status-error rounded"
            >
              <Trash2 size={16} />
            </button>
          </>
        )}
      </div>

      <div className="text-caption text-text-tertiary mb-4 flex items-center gap-3 flex-wrap">
        <span>
          작성자 <b>{doc.owner_name || `#${doc.owner_id}`}</b>
        </span>
        <span className="inline-flex items-center gap-1">
          <Share2 size={11} /> {accessLabel[doc.access_mode] || doc.access_mode}
        </span>
        <span>수정 {doc.updated_at?.slice(0, 16).replace("T", " ")}</span>
        <span className="ml-auto">
          내 권한: <b className="text-accent">{doc.permission.role || "없음"}</b>
          {!doc.permission.can_write && " (읽기 전용)"}
        </span>
      </div>

      {/* 실시간 협업 편집기 (TipTap + Yjs + Hocuspocus) */}
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

      <AIAssistantPanel
        toolKind="doc"
        toolId={did}
        applyHandler={aiApply}
        getCurrentContent={() => {
          const e = editorRef.current;
          return e ? e.getText() : "";
        }}
        open={showAI}
        onClose={() => setShowAI(false)}
      />

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
