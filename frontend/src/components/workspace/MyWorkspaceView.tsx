"use client";

/**
 * "내 작업물" 통합 페이지 — admin·student 공유 컴포넌트.
 *
 * 3개 탭: 문서 / 프리젠테이션 / 설문지
 * - 본인이 만든 것만 표시 (mine=true 필터)
 * - 강좌 무관 (강좌 안 문서도, 단독 문서도 모두)
 * - Google Forms/Docs/Slides 메인 페이지와 같은 UX
 *
 * 정렬: 최근 수정순. 클릭 시 편집기로 이동.
 *
 * baseHref:
 *   - admin: /classroom (강좌 path), /docs (단독 path) — 라우팅은 페이지에서 처리
 *   - student: /s/classroom, /s/docs
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FileText, Presentation, ClipboardList, FileSpreadsheet, Plus } from "lucide-react";
import { api } from "@/lib/api/client";

export type WorkspaceTab = "docs" | "decks" | "surveys" | "sheets";

interface BaseItem {
  id: number;
  course_id: number | null;
  owner_id: number;
  owner_name?: string;
  title: string;
  updated_at: string | null;
}

interface DocItem extends BaseItem { access_mode: string; is_archived: boolean }
interface DeckItem extends BaseItem { access_mode: string; is_archived: boolean; slide_count?: number }
interface SurveyItem extends BaseItem { access_mode: string; status: string }
interface SheetItem extends BaseItem { access_mode: string; is_archived: boolean; source_survey_id: number | null }

interface MyWorkspaceViewProps {
  /** "admin" | "student" — 권한 + path 분기 */
  mode: "admin" | "student";
  /** 초기 탭 (URL에 ?tab= 로 전달 가능) */
  initialTab?: WorkspaceTab;
}

const TAB_META: Record<WorkspaceTab, { label: string; icon: any; color: string; bg: string }> = {
  docs: { label: "문서", icon: FileText, color: "#1d4ed8", bg: "linear-gradient(135deg, #dbeafe 0%, #93c5fd 100%)" },
  decks: { label: "프리젠테이션", icon: Presentation, color: "#a16207", bg: "linear-gradient(135deg, #fde4b8 0%, #fbbf24 100%)" },
  surveys: { label: "설문지", icon: ClipboardList, color: "#7e22ce", bg: "linear-gradient(135deg, #ede9fe 0%, #c4b5fd 100%)" },
  sheets: { label: "스프레드시트", icon: FileSpreadsheet, color: "#107c41", bg: "linear-gradient(135deg, #d1fae5 0%, #6ee7b7 100%)" },
};

export function MyWorkspaceView({ mode, initialTab = "docs" }: MyWorkspaceViewProps) {
  const [tab, setTab] = useState<WorkspaceTab>(initialTab);
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [decks, setDecks] = useState<DeckItem[]>([]);
  const [surveys, setSurveys] = useState<SurveyItem[]>([]);
  const [sheets, setSheets] = useState<SheetItem[]>([]);
  const [loading, setLoading] = useState(true);

  const baseClassroom = mode === "admin" ? "/classroom" : "/s/classroom";
  const baseDocs = mode === "admin" ? "/docs" : "/s/docs";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, p, s, sh] = await Promise.all([
        api.get<{ items: DocItem[] }>("/api/classroom/docs?mine=true"),
        api.get<{ items: DeckItem[] }>("/api/classroom/decks?mine=true"),
        api.get<{ items: SurveyItem[] }>("/api/classroom/surveys?mine=true"),
        api.get<{ items: SheetItem[] }>("/api/classroom/sheets?mine=true"),
      ]);
      setDocs(d.items);
      setDecks(p.items);
      setSurveys(s.items);
      setSheets(sh.items);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const counts = { docs: docs.length, decks: decks.length, surveys: surveys.length, sheets: sheets.length };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-title text-text-primary">내 작업물</h1>
        <p className="text-caption text-text-tertiary mt-1">
          본인이 만든 문서·프리젠테이션·설문지. 공유받은 자료는 각 강좌에서 확인하세요.
        </p>
      </div>

      {/* 탭 */}
      <div className="flex items-center gap-1 border-b border-border-default mb-5">
        {(["docs", "decks", "surveys", "sheets"] as WorkspaceTab[]).map((t) => {
          const m = TAB_META[t];
          const Icon = m.icon;
          const isActive = t === tab;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-[13px] border-b-2 transition whitespace-nowrap ${
                isActive
                  ? "border-accent text-accent font-semibold"
                  : "border-transparent text-text-secondary hover:text-text-primary hover:bg-bg-secondary"
              }`}
            >
              <Icon size={14} />
              {m.label}
              <span className="ml-1 text-[11px] text-text-tertiary">{counts[t]}</span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="text-text-tertiary">로딩 중...</div>
      ) : tab === "docs" ? (
        <ItemGrid
          items={docs}
          tabMeta={TAB_META.docs}
          emptyText="아직 만든 문서가 없습니다"
          hrefFor={(d) =>
            d.course_id ? `${baseClassroom}/${d.course_id}/docs/${d.id}` : `${baseDocs}/${d.id}`
          }
        />
      ) : tab === "decks" ? (
        <ItemGrid
          items={decks}
          tabMeta={TAB_META.decks}
          emptyText="아직 만든 프리젠테이션이 없습니다"
          hrefFor={(d) =>
            d.course_id ? `${baseClassroom}/${d.course_id}/decks/${d.id}` : `${baseDocs}/decks/${d.id}`
          }
          extraInfo={(d) => (d.slide_count != null ? `슬라이드 ${d.slide_count}장` : null)}
        />
      ) : tab === "surveys" ? (
        <ItemGrid
          items={surveys}
          tabMeta={TAB_META.surveys}
          emptyText="아직 만든 설문지가 없습니다"
          hrefFor={(s) =>
            s.course_id
              ? `${baseClassroom}/${s.course_id}/surveys/${s.id}`
              : `${baseDocs}/forms/${s.id}`
          }
          extraInfo={(s) => `상태: ${s.status === "active" ? "공개 중" : s.status === "draft" ? "초안" : "마감"}`}
        />
      ) : (
        <ItemGrid
          items={sheets}
          tabMeta={TAB_META.sheets}
          emptyText="아직 만든 스프레드시트가 없습니다"
          hrefFor={(s) => mode === "admin" ? `/sheets/${s.id}` : `/s/sheets/${s.id}`}
          extraInfo={(s) => s.source_survey_id ? "설문 응답 연동" : null}
        />
      )}
    </div>
  );
}

function ItemGrid<T extends BaseItem>({
  items, tabMeta, emptyText, hrefFor, extraInfo,
}: {
  items: T[];
  tabMeta: { label: string; icon: any; color: string; bg: string };
  emptyText: string;
  hrefFor: (item: T) => string;
  extraInfo?: (item: T) => string | null;
}) {
  const Icon = tabMeta.icon;
  if (items.length === 0) {
    return (
      <div className="bg-bg-primary border-2 border-dashed border-border-default rounded-lg py-16 text-center">
        <Icon size={32} className="mx-auto text-text-tertiary mb-2" />
        <div className="text-body text-text-tertiary">{emptyText}</div>
        <div className="text-caption text-text-tertiary mt-1">
          강좌 안에서 "+ 만들기" 메뉴로 생성 가능
        </div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {items.map((it) => (
        <Link
          key={it.id}
          href={hrefFor(it)}
          className="group bg-bg-primary border border-border-default rounded-xl overflow-hidden hover:shadow-md transition-shadow"
        >
          {/* 컬러 헤더 — 타입별 그라데이션 */}
          <div
            className="px-4 py-6 flex items-center justify-center"
            style={{ background: tabMeta.bg, minHeight: "100px" }}
          >
            <Icon size={36} style={{ color: tabMeta.color }} />
          </div>
          {/* 본문 */}
          <div className="px-4 py-3">
            <div className="text-body font-medium text-text-primary truncate">{it.title}</div>
            <div className="text-[11px] text-text-tertiary mt-1 line-clamp-1">
              수정 {it.updated_at?.slice(0, 16).replace("T", " ")}
            </div>
            {extraInfo && extraInfo(it) && (
              <div className="text-[11px] text-text-tertiary mt-0.5">{extraInfo(it)}</div>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}
