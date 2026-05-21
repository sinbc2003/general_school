"use client";

/**
 * 응답 탭 — Google Forms 식 (요약 / 질문 / 개별 보기 3 sub-tab).
 *
 * 헤더:
 *  - "응답 N개" 큰 제목
 *  - "Sheets에 연결" 버튼 → 협업 스프레드시트 자동 생성
 *  - 우상단 ⋮ 메뉴 (응답 받기 toggle, Excel/CSV, 모두 삭제 placeholder)
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, Download, MoreVertical, Loader2, BarChart3 } from "lucide-react";
import { api } from "@/lib/api/client";
import { SummaryView } from "./responses/SummaryView";
import { PerQuestionView } from "./responses/PerQuestionView";
import { PerResponseView } from "./responses/PerResponseView";
import type { ResultData } from "./responses/types";

type SubTab = "summary" | "per_question" | "per_response";

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: "summary", label: "요약" },
  { key: "per_question", label: "질문" },
  { key: "per_response", label: "개별 보기" },
];


export function ResponsesTab({
  sid,
  status,
  isAuthor,
  onToggleAccepting,
}: {
  sid: number;
  status: "draft" | "active" | "closed";
  isAuthor: boolean;
  onToggleAccepting: () => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<ResultData | null>(null);
  const [loading, setLoading] = useState(true);
  const [subTab, setSubTab] = useState<SubTab>("summary");
  const [menuOpen, setMenuOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get<ResultData>(`/api/classroom/surveys/${sid}/results`);
      setData(d);
    } catch (e: any) {
      // 권한 없거나 응답 못 받는 상태에서도 빈 상태로 표시
      console.error(e);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [sid]);

  useEffect(() => { load(); }, [load]);

  const downloadFile = async (kind: "csv" | "xlsx") => {
    setMenuOpen(false);
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8002";
      const res = await fetch(`${apiUrl}/api/classroom/surveys/${sid}/results.${kind}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `survey_${sid}_results.${kind}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(`다운로드 실패: ${e?.message || e}`);
    }
  };

  const openInSpreadsheet = async () => {
    try {
      const sheet = await api.post<{ id: number }>(
        `/api/classroom/sheets/_from-survey/${sid}`, {},
      );
      router.push(`/sheets/${sheet.id}?from-survey=${sid}`);
    } catch (e: any) {
      alert(e?.detail || "스프레드시트 생성 실패");
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-10 flex items-center justify-center gap-2 text-text-tertiary">
        <Loader2 size={18} className="animate-spin" /> 응답 불러오는 중...
      </div>
    );
  }
  if (!data) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-10 text-center text-text-tertiary">
        응답을 불러올 수 없습니다.
      </div>
    );
  }

  return (
    <div>
      {/* 헤더 카드 — "응답 N개" + Sheets 연결 + ⋮ */}
      <div className="bg-white rounded-lg shadow-sm p-6 mb-3">
        <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
          <h2 className="text-[28px] font-normal text-text-primary leading-snug">
            응답 {data.response_count}개
          </h2>

          <div className="flex items-center gap-2 flex-wrap">
            {isAuthor && (
              <button
                onClick={openInSpreadsheet}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-caption rounded font-medium text-[#0b6135] hover:bg-[#e6f4ea]"
                title="응답을 협업 스프레드시트로 — 다른 교사와 공유·분석 가능"
              >
                <FileSpreadsheet size={14} className="text-[#0b6135]" />
                Sheets에 연결
              </button>
            )}
            {isAuthor && (
              <div className="relative">
                <button
                  onClick={() => setMenuOpen(!menuOpen)}
                  className="p-2 rounded hover:bg-bg-secondary"
                  aria-label="더보기"
                >
                  <MoreVertical size={16} />
                </button>
                {menuOpen && (
                  <>
                    {/* 외부 클릭 닫기 */}
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setMenuOpen(false)}
                    />
                    <div className="absolute right-0 mt-1 w-56 bg-white border border-border-default rounded-md shadow-lg z-20 py-1.5 text-caption">
                      <button
                        onClick={() => downloadFile("xlsx")}
                        className="w-full text-left px-3 py-2 hover:bg-bg-secondary inline-flex items-center gap-2"
                      >
                        <Download size={12} className="text-[#107c41]" /> 응답 다운로드 (Excel)
                      </button>
                      <button
                        onClick={() => downloadFile("csv")}
                        className="w-full text-left px-3 py-2 hover:bg-bg-secondary inline-flex items-center gap-2"
                      >
                        <Download size={12} /> 응답 다운로드 (CSV)
                      </button>
                      <div className="h-px bg-border-default my-1" />
                      <button
                        onClick={() => { setMenuOpen(false); onToggleAccepting(); }}
                        className="w-full text-left px-3 py-2 hover:bg-bg-secondary inline-flex items-center gap-2"
                      >
                        {status === "active" ? (
                          <><span className="inline-block w-2 h-2 rounded-full bg-amber-500" /> 응답 받기 중지</>
                        ) : (
                          <><span className="inline-block w-2 h-2 rounded-full bg-green-500" /> 응답 다시 받기</>
                        )}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 응답 받기 상태 — Google Forms 식 응답 받음 / 마감 toggle hint */}
        {isAuthor && (
          <div className="flex items-center gap-2 text-caption">
            <span className="text-text-tertiary">응답 받기:</span>
            <button
              onClick={onToggleAccepting}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                status === "active" ? "bg-[#673ab7]" : "bg-gray-300"
              }`}
              title={status === "active" ? "클릭하면 응답 받기 중지" : "클릭하면 응답 받기 시작"}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                  status === "active" ? "translate-x-5" : "translate-x-1"
                }`}
              />
            </button>
            <span className="text-text-secondary">
              {status === "active" ? "응답 받는 중" : status === "closed" ? "마감됨" : "초안"}
            </span>
          </div>
        )}

        {/* sub-tabs (요약/질문/개별 보기) — 보라 underline */}
        <div className="flex items-center gap-6 border-b border-border-default mt-4 -mx-6 px-6">
          {SUB_TABS.map((t) => {
            const active = subTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setSubTab(t.key)}
                className={`text-body py-3 -mb-px border-b-2 transition-colors ${
                  active
                    ? "border-[#673ab7] text-[#673ab7] font-medium"
                    : "border-transparent text-text-secondary hover:text-text-primary"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 콘텐츠 */}
      {subTab === "summary" && <SummaryView data={data} />}
      {subTab === "per_question" && <PerQuestionView data={data} />}
      {subTab === "per_response" && <PerResponseView data={data} />}
    </div>
  );
}
