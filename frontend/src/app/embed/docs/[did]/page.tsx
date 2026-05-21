"use client";

/**
 * 문서 fullscreen 임베드.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api/client";
import CollabEditor from "@/components/docs/CollabEditor";

interface Permission {
  can_read: boolean;
  can_write: boolean;
  can_share: boolean;
  role: string | null;
}

interface DocDetail {
  id: number;
  title: string;
  is_archived: boolean;
  permission: Permission;
}

export default function EmbedDocPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const did = Number(params.did);

  const [doc, setDoc] = useState<DocDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const d = await api.get<DocDetail>(`/api/classroom/docs/${did}`);
      setDoc(d);
    } catch (e: any) {
      alert(e?.detail || "문서 조회 실패");
      router.push("/drive");
    } finally {
      setLoading(false);
    }
  }, [did, router]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-6 text-text-tertiary">로딩 중...</div>;
  if (!doc) return null;
  if (!doc.permission.can_read) {
    return (
      <div className="h-full w-full flex items-center justify-center text-text-tertiary">
        이 문서에 대한 접근 권한이 없습니다.
      </div>
    );
  }

  const canWrite = doc.permission.can_write && !doc.is_archived;

  return (
    <div className="h-full w-full flex flex-col">
      <div className="flex-shrink-0 px-4 py-2 bg-white border-b border-border-default text-caption text-text-secondary flex items-center gap-2">
        <span className="font-medium text-text-primary truncate">{doc.title}</span>
        <span className="text-text-tertiary">·</span>
        <span>권한: <b className="text-accent">{doc.permission.role || "없음"}</b></span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-4">
        {user && (
          <CollabEditor
            docId={did}
            userId={user.id}
            userName={user.name}
            canWrite={canWrite}
          />
        )}
      </div>
    </div>
  );
}
