"use client";

/**
 * 협업 스프레드시트 편집기 (Univer 기반).
 *
 * 동작:
 *  - URL: /sheets/{sid}
 *  - ?from-survey=N 쿼리 → 설문 응답 데이터를 초기 주입
 *  - SheetEditor가 Univer SDK 동적 로드 (~1.5MB chunk)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, FileSpreadsheet, Share2, Sparkles, ExternalLink } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAuth } from "@/lib/auth-context";
import { useAIAssistant } from "@/lib/ai-assistant-context";
import { SheetEditor } from "@/components/sheets/SheetEditor";
import type { SheetEditorHandle } from "@/components/sheets/SheetEditor";
import { AIAssistantPanel } from "@/components/tool-ai/AIAssistantPanel";
import type { ApplyHandler } from "@/components/tool-ai/types";
import { EditableTitle } from "@/components/ui/EditableTitle";
import { ShareDocModal } from "@/components/classroom/ShareDocModal";
import { useAutoCollapseSidebar } from "@/lib/hooks/use-auto-collapse-sidebar";

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
  useAutoCollapseSidebar();
  const params = useParams();
  const router = useRouter();
  const sp = useSearchParams();
  const { user } = useAuth();
  const sid = Number(params.sid);
  const fromSurvey = sp?.get("from-survey");

  const [sheet, setSheet] = useState<SheetDetail | null>(null);
  const [seedData, setSeedData] = useState<SurveyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAI, setShowAI] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const sheetHandleRef = useRef<SheetEditorHandle | null>(null);
  const ai = useAIAssistant();

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
      router.push("/drive");
    } finally {
      setLoading(false);
    }
  }, [sid, fromSurvey, router]);

  useEffect(() => { load(); }, [load]);

  const aiApply: ApplyHandler = async (call) => {
    if (call.name === "sheet_write_cells") {
      const handle = sheetHandleRef.current;
      if (!handle) {
        alert("시트가 아직 준비되지 않았습니다.");
        return;
      }
      const cells = Array.isArray(call.arguments.cells) ? call.arguments.cells : [];
      handle.writeCells(cells);
    }
  };

  if (loading) return <div className="text-text-tertiary">로딩 중...</div>;
  if (!sheet) return null;

  return (
    // -m-6 + h-screen 으로 admin layout main p-6 padding 상쇄, viewport 가득 채움.
    // AI 패널 우측 padding은 admin layout이 처리 (이중 적용 방지).
    <div
      className="-m-6 flex flex-col h-screen overflow-hidden bg-bg-secondary"
    >
      <div className="flex-shrink-0 px-6 pt-5 pb-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <Link
            href="/drive"
            className="text-caption text-text-tertiary hover:text-accent inline-flex items-center gap-1"
          >
            <ArrowLeft size={12} /> 시트 목록
          </Link>
          <div className="flex items-center gap-2 text-caption text-text-tertiary flex-wrap">
            <span>만든이 {sheet.owner_name || `#${sheet.owner_id}`}</span>
            <span>·</span>
            <span>권한: <b className="text-accent">{sheet.permission.role || "없음"}</b></span>
          <button
            onClick={() => window.open(`/embed/sheets/${sid}`, "_blank", "noopener,noreferrer")}
            className="ml-2 inline-flex items-center gap-1 px-2.5 py-1 text-[11.5px] bg-white border border-border-default rounded hover:bg-bg-secondary"
            title="새 창에서 열기 (사이드바 없이 시트만 표시)"
          >
            <ExternalLink size={11} /> 새 창
          </button>
          {sheet.permission.can_share && (
            <button
              onClick={() => setShowShare(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11.5px] bg-white border border-border-default rounded hover:bg-bg-secondary"
              title="공유 — 사용자 추가 + 액세스 모드"
            >
              <Share2 size={11} /> 공유
            </button>
          )}
          {sheet.permission.can_write && (
            <button
              onClick={() => setShowAI(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11.5px] text-[#673ab7] border border-[#e8def8] rounded hover:bg-[#f3e5f5]"
              title="AI 도우미 (출석부·평가지 등 자동 생성)"
            >
              <Sparkles size={11} /> AI
            </button>
          )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <FileSpreadsheet size={20} className="text-[#107c41] flex-shrink-0" />
          <EditableTitle
            value={sheet.title}
            canEdit={sheet.permission.can_write}
            onSave={async (next) => {
              try {
                await api.put(`/api/classroom/sheets/${sid}`, { title: next });
                await load();
              } catch (e: any) {
                alert(e?.detail || "제목 저장 실패");
              }
            }}
          />
        </div>
      </div>

      <div className="flex-1 px-6 pb-6 min-h-0 overflow-hidden">
        {user ? (
          <SheetEditor
            sheetId={sid}
            canWrite={sheet.permission.can_write}
            userId={user.id}
            userName={user.name}
            seedData={seedData}
            onReady={(h) => { sheetHandleRef.current = h; }}
          />
        ) : (
          <div className="text-text-tertiary">사용자 정보 로딩 중...</div>
        )}
      </div>

      <AIAssistantPanel
        toolKind="sheet"
        toolId={sid}
        applyHandler={aiApply}
        getCurrentContent={() => `시트 제목: ${sheet.title}`}
        open={showAI}
        onClose={() => setShowAI(false)}
      />

      {showShare && (
        <ShareDocModal
          entityType="sheet"
          docId={sid}
          docTitle={sheet.title}
          ownerId={sheet.owner_id}
          canShare={sheet.permission.can_share}
          currentAccessMode={sheet.access_mode as any}
          onClose={() => setShowShare(false)}
          onChanged={load}
        />
      )}
    </div>
  );
}
