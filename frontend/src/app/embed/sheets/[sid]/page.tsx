"use client";

/**
 * 시트 fullscreen 임베드 — admin 사이드바 없이 도구만 가득 채움.
 * 새 창에서 작업하거나 듀얼 모니터 보조 화면용.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api/client";
import { SheetEditor } from "@/components/sheets/SheetEditor";

interface Permission {
  can_read: boolean;
  can_write: boolean;
  can_share: boolean;
  role: string | null;
}

interface SheetDetail {
  id: number;
  title: string;
  permission: Permission;
  source_survey_id: number | null;
}

interface SurveyData {
  headers: string[];
  rows: any[][];
  survey_title: string;
}

export default function EmbedSheetPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const sid = Number(params.sid);

  const [sheet, setSheet] = useState<SheetDetail | null>(null);
  const [seedData, setSeedData] = useState<SurveyData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const s = await api.get<SheetDetail>(`/api/classroom/sheets/${sid}`);
      setSheet(s);
      if (s.source_survey_id) {
        try {
          const data = await api.get<SurveyData>(
            `/api/classroom/sheets/_survey-data/${s.source_survey_id}`,
          );
          setSeedData(data);
        } catch {}
      }
    } catch (e: any) {
      alert(e?.detail || "시트 조회 실패");
      router.push("/drive");
    } finally {
      setLoading(false);
    }
  }, [sid, router]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-6 text-text-tertiary">로딩 중...</div>;
  if (!sheet) return null;
  if (!sheet.permission.can_read) {
    return (
      <div className="h-full w-full flex items-center justify-center text-text-tertiary">
        이 시트에 대한 접근 권한이 없습니다.
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col">
      <div className="flex-shrink-0 px-4 py-2 bg-white border-b border-border-default text-caption text-text-secondary flex items-center gap-2">
        <span className="font-medium text-text-primary truncate">{sheet.title}</span>
        <span className="text-text-tertiary">·</span>
        <span>권한: <b className="text-accent">{sheet.permission.role || "없음"}</b></span>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {user && (
          <SheetEditor
            sheetId={sid}
            canWrite={sheet.permission.can_write}
            userId={user.id}
            userName={user.name}
            seedData={seedData}
          />
        )}
      </div>
    </div>
  );
}
