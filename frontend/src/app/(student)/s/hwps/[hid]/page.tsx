"use client";

/**
 * 학생용 단독 HWP 편집기 — course_id 없는 HWP.
 *
 * Layout: -m-6 + h-screen으로 layout main p-6 padding 상쇄, viewport 가득 채움.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Share2, ExternalLink, Sparkles } from "lucide-react";
import { api } from "@/lib/api/client";
import { HwpEditor } from "@/components/hwp/HwpEditor";
import { ShareDocModal } from "@/components/classroom/ShareDocModal";
import { EditableTitle } from "@/components/ui/EditableTitle";
import { AIAssistantPanel } from "@/components/tool-ai/AIAssistantPanel";
import type { ApplyHandler } from "@/components/tool-ai/types";
import { useAutoCollapseSidebar } from "@/lib/hooks/use-auto-collapse-sidebar";
import { useToast } from "@/components/ui/Toast";
import { useAIAssistant } from "@/lib/ai-assistant-context";
import { useAuth } from "@/lib/auth-context";

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
  useAutoCollapseSidebar();
  const params = useParams();
  const router = useRouter();
  const hid = Number(params.hid);
  const toast = useToast();
  const ai = useAIAssistant();
  const { hasPermission } = useAuth();
  const canUseAI = hasPermission("tool.ai_assistant.use");

  const [doc, setDoc] = useState<HwpDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showShare, setShowShare] = useState(false);
  const [showAI, setShowAI] = useState(false);

  const aiApply: ApplyHandler = async (call) => {
    const md = String(call.arguments.markdown || "");
    if (!md) return;
    try {
      await navigator.clipboard.writeText(md);
      toast.show("AI 생성 내용 복사됨 — 한컴 문서에 Ctrl+V로 붙여넣으세요", "success");
    } catch {
      alert(`복사 실패. 아래 내용을 직접 복사하세요:\n\n${md.slice(0, 500)}${md.length > 500 ? "..." : ""}`);
    }
  };

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

  // 페이지 진입 시 AI 패널 닫힌 상태 강제 (다른 페이지에서 켜둔 잔여 state 클리어)
  useEffect(() => {
    ai.setOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <div className="p-6 text-text-tertiary">로딩 중...</div>;
  if (!doc) return null;

  const accessLabel: Record<string, string> = {
    course_members: "강좌 멤버",
    specific_users: "지정 사용자",
    link_public: "링크 공유",
  };

  return (
    <div
      className="-m-6 flex flex-col h-screen overflow-hidden bg-bg-secondary"
      style={ai.open ? { marginRight: 0 } : undefined}
    >
      <div className="flex-shrink-0 px-4 pt-3 pb-1.5">
        <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
          <Link
            href="/s/drive"
            className="text-caption text-text-tertiary hover:text-accent inline-flex items-center gap-1"
          >
            <ArrowLeft size={12} /> 내 드라이브
          </Link>
          <div className="flex items-center gap-3 text-caption text-text-tertiary flex-wrap">
            <span>만든이 <b>{doc.owner_name || `#${doc.owner_id}`}</b></span>
            <button
              onClick={() => setShowShare(true)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-bg-primary"
              title="공유 정보"
            >
              <Share2 size={11} /> {accessLabel[doc.access_mode] || doc.access_mode}
            </button>
            <span>수정 {doc.updated_at?.slice(0, 16).replace("T", " ")}</span>
            <span>
              내 권한: <b className="text-accent">{doc.permission.role || "없음"}</b>
              {!doc.permission.can_write && " (읽기 전용)"}
            </span>
            <button
              onClick={() => window.open(`/embed/hwps/${hid}`, "_blank", "noopener,noreferrer")}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11.5px] text-text-tertiary border border-border-default rounded hover:bg-bg-primary"
              title="새 창에서 열기"
            >
              <ExternalLink size={11} /> 새 창
            </button>
            {canUseAI && doc.permission.can_write && !doc.is_archived && (
              <button
                onClick={() => setShowAI(true)}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11.5px] text-[#673ab7] border border-[#e8def8] rounded hover:bg-[#f3e5f5]"
                title="AI 도우미 (생성된 내용을 클립보드 복사 후 한컴에 붙여넣기)"
              >
                <Sparkles size={11} /> AI
              </button>
            )}
          </div>
        </div>

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

      <div className="flex-1 min-h-0 px-4 pb-2">
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

      {canUseAI && (
        <AIAssistantPanel
          toolKind="doc"
          toolId={hid}
          applyHandler={aiApply}
          getCurrentContent={() => `한컴 문서 제목: ${doc.title}`}
          open={showAI}
          onClose={() => setShowAI(false)}
        />
      )}
    </div>
  );
}
