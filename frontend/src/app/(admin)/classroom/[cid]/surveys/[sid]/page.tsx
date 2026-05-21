"use client";

/**
 * 설문 빌더 + 응답 + 설정 — Google Forms 식 탭 통합 페이지.
 *
 * URL 쿼리 ?tab=questions|responses|settings (기본 questions).
 * 기존 /results 페이지는 ?tab=responses로 자동 리다이렉트.
 *
 * 분할 (_components/):
 *   - QuestionsTab.tsx : 빌더 본체
 *   - ResponsesTab.tsx : 응답 sub-tabs (요약/질문/개별 보기)
 *   - SettingsTab.tsx  : 설문 설정
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft, Trash2, Lock, Eye, Share2, MoreVertical, Pencil, Archive, Sparkles,
  CalendarClock,
} from "lucide-react";
import { api } from "@/lib/api/client";
import ShareLinkModal from "@/components/classroom/ShareLinkModal";
import { AIAssistantPanel } from "@/components/tool-ai/AIAssistantPanel";
import type { ApplyHandler } from "@/components/tool-ai/types";
import { QuestionsTab } from "./_components/QuestionsTab";
import { ResponsesTab } from "./_components/ResponsesTab";
import { SettingsTab } from "./_components/SettingsTab";
import type { Question } from "./_components/_types";


interface SurveyDetail {
  id: number;
  course_id: number | null;
  author_id: number;
  author_name?: string;
  title: string;
  description: string | null;
  status: "draft" | "active" | "closed";
  is_anonymous: boolean;
  allow_multiple_responses: boolean;
  access_mode: string;
  response_edit_minutes: number;
  open_at: string | null;
  close_at: string | null;
  questions: Question[];
  is_author: boolean;
  response_count: number | null;
}

type Tab = "questions" | "responses" | "settings";


export default function SurveyBuilderPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const cid = Number(params.cid);
  const sid = Number(params.sid);
  const tabParam = (searchParams.get("tab") as Tab) || "questions";
  const validTab: Tab = ["questions", "responses", "settings"].includes(tabParam)
    ? tabParam
    : "questions";

  const [survey, setSurvey] = useState<SurveyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [titleDraft, setTitleDraft] = useState("");
  const [showShare, setShowShare] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showAI, setShowAI] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await api.get<SurveyDetail>(`/api/classroom/surveys/${sid}`);
      setSurvey(s);
      setTitleDraft(s.title);
    } catch (e: any) {
      alert(e?.detail || "설문 조회 실패");
      router.push(`/classroom/${cid}/surveys`);
    } finally {
      setLoading(false);
    }
  }, [cid, sid, router]);

  useEffect(() => { load(); }, [load]);

  const setTab = (t: Tab) => {
    const sp = new URLSearchParams(searchParams.toString());
    if (t === "questions") sp.delete("tab");
    else sp.set("tab", t);
    const qs = sp.toString();
    router.replace(`/classroom/${cid}/surveys/${sid}${qs ? "?" + qs : ""}`, { scroll: false });
  };

  const updateMeta = async (patch: Partial<SurveyDetail> | Record<string, unknown>) => {
    try {
      await api.put(`/api/classroom/surveys/${sid}`, patch);
      await load();
    } catch (e: any) {
      alert(e?.detail || "변경 실패");
    }
  };

  const saveTitle = async () => {
    if (!titleDraft.trim() || !survey || titleDraft === survey.title) return;
    await updateMeta({ title: titleDraft.trim() });
  };

  const deleteQuestion = async (qid: number) => {
    if (!confirm("질문을 삭제합니까?")) return;
    try {
      await api.delete(`/api/classroom/surveys/questions/${qid}`);
      await load();
    } catch (e: any) {
      alert(e?.detail || "삭제 실패");
    }
  };

  const reorderQuestions = async (ids: number[]) => {
    if (!survey) return;
    const map = new Map(survey.questions.map((q) => [q.id, q]));
    const reordered = ids.map((id, i) => ({ ...map.get(id)!, order: i }));
    setSurvey({ ...survey, questions: reordered });
    try {
      await api.post(`/api/classroom/surveys/${sid}/questions/_reorder`, { question_ids: ids });
    } catch (e: any) {
      alert(e?.detail || "순서 저장 실패");
      load();
    }
  };

  const deleteSurvey = async () => {
    setMenuOpen(false);
    if (!confirm("이 설문을 삭제합니다. 응답까지 모두 사라집니다.")) return;
    try {
      await api.delete(`/api/classroom/surveys/${sid}`);
      router.push(`/classroom/${cid}/surveys`);
    } catch (e: any) {
      alert(e?.detail || "삭제 실패");
    }
  };

  const aiApply: ApplyHandler = async (call) => {
    if (call.name === "survey_add_question") {
      const a = call.arguments;
      const body: Record<string, unknown> = {
        question_text: String(a.question_text || "").trim(),
        question_type: a.question_type,
        is_required: !!a.is_required,
      };
      if (a.question_type === "single_choice" || a.question_type === "multi_choice") {
        body.options = Array.isArray(a.options) ? a.options : [];
      }
      if (a.question_type === "rating" && a.rating_max) {
        body.rating_max = Number(a.rating_max);
      }
      await api.post(`/api/classroom/surveys/${sid}/questions`, body);
      await load();
    }
  };

  const toggleAccepting = async () => {
    if (!survey) return;
    if (survey.status === "draft") {
      await updateMeta({ status: "active" });
    } else if (survey.status === "active") {
      await updateMeta({ status: "closed" });
    } else {
      await updateMeta({ status: "active" });
    }
  };

  if (loading) return <div className="text-text-tertiary">로딩 중...</div>;
  if (!survey) return null;

  const isDraft = survey.status === "draft";
  const isActive = survey.status === "active";
  const isClosed = survey.status === "closed";
  const canEdit = survey.is_author && isDraft;
  const respondUrl = `/s/classroom/${cid}/surveys/${sid}`;

  return (
    // Google Forms 식 — 옅은 라벤더 페이지 배경, 보라 액센트
    <div className="min-h-[calc(100vh-150px)] -mx-4 -my-4 px-4 py-6 bg-[#f0ebf8]">
      <div className="max-w-3xl mx-auto">
        {/* 상단 헤더 row */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <Link
            href="/drive"
            className="text-caption text-text-tertiary hover:text-accent inline-flex items-center gap-1 mr-2"
          >
            <ArrowLeft size={12} /> 내 드라이브
          </Link>
          <span className={`text-caption px-2 py-0.5 rounded ${
            isDraft ? "bg-white text-text-secondary border border-border-default"
              : isActive ? "bg-green-100 text-green-700"
              : "bg-amber-100 text-amber-700"
          }`}>
            {isDraft ? "초안" : isActive ? "응답 받는 중" : "마감"}
          </span>
          {survey.is_anonymous && (
            <span className="text-caption px-2 py-0.5 rounded bg-white border border-border-default inline-flex items-center gap-1">
              <Lock size={11} /> 익명
            </span>
          )}
          {(survey.open_at || survey.close_at) && (
            <span
              className="text-caption px-2 py-0.5 rounded bg-white border border-border-default inline-flex items-center gap-1"
              title={`응답 기간: ${survey.open_at ? formatLocal(survey.open_at) : "즉시"} ~ ${survey.close_at ? formatLocal(survey.close_at) : "마감 없음"}`}
            >
              <CalendarClock size={11} />
              {survey.open_at ? formatLocal(survey.open_at) : "지금"}
              {" ~ "}
              {survey.close_at ? formatLocal(survey.close_at) : "마감 없음"}
            </span>
          )}

          <div className="flex-1" />

          {survey.is_author && (
            <div className="flex items-center gap-1">
              {/* AI 도우미 토글 */}
              <button
                onClick={() => setShowAI(true)}
                className="p-2 rounded hover:bg-white/60 text-[#673ab7]"
                title="AI 도우미 (질문 자동 생성)"
              >
                <Sparkles size={16} />
              </button>
              {/* 미리보기 (응답자 화면) */}
              <Link
                href={respondUrl}
                target="_blank"
                className="p-2 rounded hover:bg-white/60 text-text-secondary"
                title="미리보기 (응답자 화면, 새 탭)"
              >
                <Eye size={16} />
              </Link>

              {/* 공유 / 보내기 */}
              {(isActive || isClosed) && (
                <button
                  onClick={() => setShowShare(true)}
                  className="p-2 rounded hover:bg-white/60 text-text-secondary"
                  title="단축 링크 + QR 공유"
                >
                  <Share2 size={16} />
                </button>
              )}

              {/* 게시 / 마감 / 초안으로 */}
              {isDraft && (
                <button
                  onClick={() => updateMeta({ status: "active" })}
                  className="ml-1 px-4 py-1.5 text-caption bg-[#673ab7] text-white rounded-md hover:bg-[#5e35b1] font-medium"
                  title="응답 받기 시작"
                >
                  게시
                </button>
              )}
              {isActive && (
                <button
                  onClick={() => updateMeta({ status: "closed" })}
                  className="ml-1 px-3 py-1.5 text-caption bg-white border border-border-default text-text-primary rounded-md hover:bg-bg-secondary inline-flex items-center gap-1"
                >
                  <Archive size={12} /> 마감
                </button>
              )}
              {isClosed && (
                <button
                  onClick={() => updateMeta({ status: "draft" })}
                  className="ml-1 px-3 py-1.5 text-caption bg-white border border-border-default rounded-md hover:bg-bg-secondary inline-flex items-center gap-1"
                  title="초안으로 (질문 편집 가능)"
                >
                  <Pencil size={12} /> 초안으로
                </button>
              )}

              {/* 더보기 메뉴 */}
              <div className="relative ml-1">
                <button
                  onClick={() => setMenuOpen(!menuOpen)}
                  className="p-2 rounded hover:bg-white/60 text-text-secondary"
                  aria-label="더보기"
                >
                  <MoreVertical size={16} />
                </button>
                {menuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setMenuOpen(false)}
                    />
                    <div className="absolute right-0 mt-1 w-48 bg-white border border-border-default rounded-md shadow-lg z-20 py-1 text-caption">
                      <button
                        onClick={deleteSurvey}
                        className="w-full text-left px-3 py-2 hover:bg-bg-secondary inline-flex items-center gap-2 text-status-error"
                      >
                        <Trash2 size={12} /> 설문 삭제
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 탭 네비 — Google Forms 식 (가운데 정렬, 보라 underline) */}
        <div className="flex items-center justify-center gap-8 border-b border-[#dadce0] mb-6">
          <TabButton
            label="질문"
            active={validTab === "questions"}
            onClick={() => setTab("questions")}
          />
          <TabButton
            label="응답"
            badge={survey.response_count ?? undefined}
            active={validTab === "responses"}
            onClick={() => setTab("responses")}
          />
          <TabButton
            label="설정"
            active={validTab === "settings"}
            onClick={() => setTab("settings")}
          />
        </div>

        {/* 탭별 내용 */}
        {validTab === "questions" && (
          <QuestionsTab
            sid={sid}
            survey={{
              title: survey.title,
              description: survey.description,
              questions: survey.questions,
              status: survey.status,
            }}
            canEdit={canEdit}
            titleDraft={titleDraft}
            setTitleDraft={setTitleDraft}
            saveTitle={saveTitle}
            onUpdateMeta={updateMeta}
            onReorder={reorderQuestions}
            onDeleteQuestion={deleteQuestion}
            onReload={load}
          />
        )}

        {validTab === "responses" && (
          <ResponsesTab
            sid={sid}
            status={survey.status}
            isAuthor={survey.is_author}
            onToggleAccepting={toggleAccepting}
          />
        )}

        {validTab === "settings" && (
          <SettingsTab
            survey={{
              is_anonymous: survey.is_anonymous,
              allow_multiple_responses: survey.allow_multiple_responses,
              access_mode: survey.access_mode,
              response_edit_minutes: survey.response_edit_minutes,
              open_at: survey.open_at,
              close_at: survey.close_at,
            }}
            canEdit={canEdit}
            isAuthor={survey.is_author}
            onUpdate={updateMeta}
          />
        )}

        {showShare && (
          <ShareLinkModal
            targetType="survey"
            targetId={sid}
            targetTitle={survey.title}
            onClose={() => setShowShare(false)}
          />
        )}
      </div>

      <AIAssistantPanel
        toolKind="survey"
        toolId={sid}
        applyHandler={aiApply}
        getCurrentContent={() => {
          const lines = [`제목: ${survey.title}`];
          if (survey.description) lines.push(`설명: ${survey.description}`);
          lines.push(`현재 질문 ${survey.questions.length}개:`);
          survey.questions.forEach((q, i) => {
            lines.push(`${i + 1}. [${q.question_type}] ${q.question_text}`);
          });
          return lines.join("\n");
        }}
        open={showAI}
        onClose={() => setShowAI(false)}
      />
    </div>
  );
}


function formatLocal(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}


function TabButton({
  label, active, onClick, badge,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative py-3 text-body transition-colors border-b-2 ${
        active
          ? "border-[#673ab7] text-[#673ab7] font-medium"
          : "border-transparent text-text-secondary hover:text-text-primary"
      }`}
    >
      <span className="inline-flex items-center gap-1.5">
        {label}
        {badge !== undefined && badge > 0 && (
          <span className={`inline-flex items-center justify-center min-w-[20px] h-[18px] px-1.5 text-[11px] font-medium rounded-full ${
            active ? "bg-[#673ab7] text-white" : "bg-[#e8def8] text-[#673ab7]"
          }`}>
            {badge}
          </span>
        )}
      </span>
    </button>
  );
}
