"use client";

/**
 * HWP fullscreen 임베드.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api/client";
import { HwpEditor } from "@/components/hwp/HwpEditor";

interface Permission {
  can_read: boolean;
  can_write: boolean;
  can_share: boolean;
  role: string | null;
}

interface HwpDetail {
  id: number;
  title: string;
  file_path: string | null;
  file_format: "hwp" | "hwpx" | null;
  is_archived: boolean;
  permission: Permission;
}

export default function EmbedHwpPage() {
  const params = useParams();
  const router = useRouter();
  const hid = Number(params.hid);

  const [doc, setDoc] = useState<HwpDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const d = await api.get<HwpDetail>(`/api/classroom/hwps/${hid}`);
      setDoc(d);
    } catch (e: any) {
      alert(e?.detail || "HWP 조회 실패");
      router.push("/drive");
    } finally {
      setLoading(false);
    }
  }, [hid, router]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-6 text-text-tertiary">로딩 중...</div>;
  if (!doc) return null;
  if (!doc.permission.can_read) {
    return (
      <div className="h-full w-full flex items-center justify-center text-text-tertiary">
        이 HWP에 대한 접근 권한이 없습니다.
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
      <div className="flex-1 min-h-0">
        <HwpEditor
          hwpId={hid}
          canWrite={canWrite}
          initialFilePath={doc.file_path}
          initialFileFormat={doc.file_format}
          onSaved={load}
        />
      </div>
    </div>
  );
}
