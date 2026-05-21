"use client";

/**
 * 학생용 단독 HWP 편집기 — course_id 없는 HWP.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Share2, ExternalLink } from "lucide-react";
import { api } from "@/lib/api/client";
import { HwpEditor } from "@/components/hwp/HwpEditor";
import { ShareDocModal } from "@/components/classroom/ShareDocModal";
import { EditableTitle } from "@/components/ui/EditableTitle";

interface Permission {
  can_read: boolean;
  can_write: boolean;
  can_share: boolean;
  role: string | null;
}

interface HwpDetail {
  id: number;
  course_id: number | null;
  owner_id: number;
  owner_name?: string;
  title: string;
  access_mode: string;
  file_path: string | null;
  file_format: "hwp" | "hwpx" | null;
  is_archived: boolean;
  storage_bytes: number;
  updated_at: string | null;
  permission: Permission;
}

export default function StudentStandaloneHwpPage() {
  const params = useParams();
  const router = useRouter();
  const hid = Number(params.hid);

  const [doc, setDoc] = useState<HwpDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showShare, setShowShare] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get<HwpDetail>(`/api/classroom/hwps/${hid}`);
      setDoc(d);
    } catch (e: any) {
      alert(e?.detail || "HWP 조회 실패");
      router.push("/s/drive");
    } finally {
      setLoading(false);
    }
  }, [hid, router]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="text-text-tertiary">로딩 중...</div>;
  if (!doc) return null;

  const accessLabel: Record<string, string> = {
    course_members: "강좌 멤버",
    specific_users: "지정 사용자",
    link_public: "링크 공유",
  };

  return (
    <div className="w-full h-[calc(100vh-7rem)] flex flex-col">
      <div className="mb-3 flex-shrink-0">
        <Link
          href="/s/drive"
          className="text-caption text-text-tertiary hover:text-accent inline-flex items-center gap-1"
        >
          <ArrowLeft size={12} /> 내 드라이브
        </Link>
      </div>

      <div className="mb-2 flex-shrink-0">
        <EditableTitle
          value={doc.title}
          canEdit={doc.permission.can_write && !doc.is_archived}
          onSave={async (next) => {
            try {
              await api.put(`/api/classroom/hwps/${hid}`, { title: next });
              await load();
            } catch (e: any) {
              alert(e?.detail || "제목 저장 실패");
            }
          }}
        />
      </div>

      <div className="text-caption text-text-tertiary mb-4 flex items-center gap-3 flex-wrap flex-shrink-0">
        <span>만든이 <b>{doc.owner_name || `#${doc.owner_id}`}</b></span>
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
          onClick={() => window.open(`/embed/hwps/${hid}`, "_blank", "noopener,noreferrer")}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11.5px] text-text-tertiary border border-border-default rounded hover:bg-bg-secondary"
          title="새 창에서 열기"
        >
          <ExternalLink size={11} /> 새 창
        </button>
      </div>

      <div className="flex-1 min-h-0">
        <HwpEditor
          hwpId={hid}
          canWrite={doc.permission.can_write && !doc.is_archived}
          initialFilePath={doc.file_path}
          initialFileFormat={doc.file_format}
          onSaved={load}
        />
      </div>

      {showShare && (
        <ShareDocModal
          docId={hid}
          docTitle={doc.title}
          ownerId={doc.owner_id}
          canShare={doc.permission.can_share}
          currentAccessMode={doc.access_mode as any}
          entityType="hwp"
          onClose={() => setShowShare(false)}
          onChanged={load}
        />
      )}
    </div>
  );
}
