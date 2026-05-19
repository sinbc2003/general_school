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
  const cid = Number(params.cid);
  const did = Number(params.did);

  const [doc, setDoc] = useState<DocDetail | null>(null);
  const [loading, setLoading] = useState(true);

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
        <span className="inline-flex items-center gap-1">
          <Share2 size={11} /> {accessLabel[doc.access_mode] || doc.access_mode}
        </span>
        <span>수정 {doc.updated_at?.slice(0, 16).replace("T", " ")}</span>
        <span className="ml-auto">
          내 권한: <b className="text-accent">{doc.permission.role || "없음"}</b>
          {!doc.permission.can_write && " (읽기 전용)"}
        </span>
      </div>

      {/* 편집기 자리 — Phase A+B-4에서 CollabEditor 컴포넌트로 교체 */}
      <div className="border border-border-default rounded-lg p-8 bg-bg-primary min-h-[400px]">
        <div className="text-caption text-text-tertiary text-center py-10 space-y-2">
          <div className="text-body font-medium">실시간 협업 편집기</div>
          <div>곧 여기서 친구들과 동시에 편집할 수 있게 됩니다.</div>
          <div className="text-[11px] mt-4">
            현재는 준비 중입니다. (Hocuspocus 서버 연동 대기)
          </div>
        </div>
      </div>
    </div>
  );
}
