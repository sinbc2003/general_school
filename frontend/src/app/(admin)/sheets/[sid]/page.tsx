"use client";

/**
 * 협업 스프레드시트 편집기 (Univer 기반).
 *
 * 동작:
 *  - URL: /sheets/{sid}
 *  - ?from-survey=N 쿼리 → 설문 응답 데이터를 초기 주입
 *  - SheetEditor가 Univer SDK 동적 로드 (~1.5MB chunk)
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, FileSpreadsheet, Share2 } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAuth } from "@/lib/auth-context";
import { SheetEditor } from "@/components/sheets/SheetEditor";

interface Permission {
  can_read: boolean;
  can_write: boolean;
  can_share: boolean;
  role: string | null;
}

interface SheetDetail {
  id: number;
  course_id: number | null;
  owner_id: number;
  owner_name?: string;
  title: string;
  access_mode: string;
  source_survey_id: number | null;
  permission: Permission;
}

interface SurveyData {
  headers: string[];
  rows: any[][];
  survey_title: string;
}

export default function SheetEditorPage() {
  const params = useParams();
  const router = useRouter();
  const sp = useSearchParams();
  const { user } = useAuth();
  const sid = Number(params.sid);
  const fromSurvey = sp?.get("from-survey");

  const [sheet, setSheet] = useState<SheetDetail | null>(null);
  const [seedData, setSeedData] = useState<SurveyData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await api.get<SheetDetail>(`/api/classroom/sheets/${sid}`);
      setSheet(s);

      // 첫 로드 + 설문 연동 → 응답 데이터 미리 가져옴
      if (fromSurvey && !s.source_survey_id) {
        // URL에 from-survey가 있지만 시트는 아직 source_survey_id 안 박힘 — frontend 주입만
        try {
          const data = await api.get<SurveyData>(
            `/api/classroom/sheets/_survey-data/${fromSurvey}`,
          );
          setSeedData(data);
        } catch {}
      } else if (s.source_survey_id) {
        try {
          const data = await api.get<SurveyData>(
            `/api/classroom/sheets/_survey-data/${s.source_survey_id}`,
          );
          setSeedData(data);
        } catch {}
      }
    } catch (e: any) {
      alert(e?.detail || "시트 조회 실패");
      router.push("/workspace?tab=sheets");
    } finally {
      setLoading(false);
    }
  }, [sid, fromSurvey, router]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="text-text-tertiary">로딩 중...</div>;
  if (!sheet) return null;

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
        <Link
          href="/workspace?tab=sheets"
          className="text-caption text-text-tertiary hover:text-accent inline-flex items-center gap-1"
        >
          <ArrowLeft size={12} /> 시트 목록
        </Link>
        <div className="flex items-center gap-2 text-caption text-text-tertiary flex-wrap">
          <FileSpreadsheet size={13} className="text-[#107c41]" />
          <b className="text-text-primary">{sheet.title}</b>
          <span>·</span>
          <span>만든이 {sheet.owner_name || `#${sheet.owner_id}`}</span>
          <span>·</span>
          <span>권한: <b className="text-accent">{sheet.permission.role || "없음"}</b></span>
          {sheet.permission.can_share && (
            <button
              onClick={() => alert("공유 기능: SheetMember API 사용 (UI 추가 예정)")}
              className="ml-2 inline-flex items-center gap-1 px-2.5 py-1 text-[11.5px] bg-white border border-border-default rounded hover:bg-bg-secondary"
            >
              <Share2 size={11} /> 공유
            </button>
          )}
        </div>
      </div>

      {user ? (
        <SheetEditor
          sheetId={sid}
          canWrite={sheet.permission.can_write}
          userId={user.id}
          userName={user.name}
          seedData={seedData}
        />
      ) : (
        <div className="text-text-tertiary">사용자 정보 로딩 중...</div>
      )}

      <div className="mt-2 text-[11px] text-text-tertiary">
        ⓘ 동시 편집 활성 — 다른 사용자의 변경이 ~350ms 후 화면에 반영됩니다.
        같은 셀에 동시 입력 시 마지막 입력이 우선 (셀 LWW).
      </div>
    </div>
  );
}
