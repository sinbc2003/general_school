"use client";

/**
 * 학생용 협업 문서 편집기 placeholder.
 *
 * Phase A+B-4에서 CollabEditor (TipTap + Yjs + Hocuspocus)로 교체.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Share2 } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAuth } from "@/lib/auth-context";
import CollabEditor from "@/components/docs/CollabEditor";
import { ShareDocModal } from "@/components/classroom/ShareDocModal";

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

export default function StudentDocEditorPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const cid = Number(params.cid);
  const did = Number(params.did);

  const [doc, setDoc] = useState<DocDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showShare, setShowShare] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get<DocDetail>(`/api/classroom/docs/${did}`);
      setDoc(d);
    } catch (e: any) {
      alert(e?.detail || "문서 조회 실패");
      router.push(`/s/classroom/${cid}/docs`);
    } finally {
      setLoading(false);
    }
  }, [cid, did, router]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="text-text-tertiary">로딩 중...</div>;
  if (!doc) return null;

  const accessLabel: Record<string, string> = {
    course_members: "강좌 멤버",
    specific_users: "지정 사용자",
    link_public: "링크 공유",
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-3">
        <Link
          href={`/s/classroom/${cid}/docs`}
          className="text-caption text-text-tertiary hover:text-accent inline-flex items-center gap-1"
        >
          <ArrowLeft size={12} /> 협업 문서 목록
        </Link>
      </div>

      <h1 className="text-title text-text-primary mb-2">{doc.title}</h1>

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
      </div>

      {/* 실시간 협업 편집기 */}
      {user ? (
        <CollabEditor
          docId={did}
          userId={user.id}
          userName={user.name}
          canWrite={doc.permission.can_write && !doc.is_archived}
        />
      ) : (
        <div className="border border-border-default rounded-lg p-8 text-center text-text-tertiary">
          사용자 정보 로딩 중...
        </div>
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
