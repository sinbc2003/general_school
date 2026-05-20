"use client";

/**
 * 내 드라이브 — 협업 도구 자료 통합 그리드 + Quota 게이지 + 휴지통(30일 복구).
 *
 * 탭 6개: 전체 / 문서 / 시트 / 덱 / 설문 / 휴지통
 * - 활성 탭 5개는 deleted_at IS NULL만 표시
 * - 휴지통 탭은 deleted_at IS NOT NULL만 표시 + 복구/영구삭제 버튼
 *
 * 상단:
 *   - 사용량 게이지 (used/quota, 80%/90% 색 변화)
 *   - 만료 임박 배너 (시간강사: 7일 이내)
 *
 * 행동:
 *   - 카드 클릭 → 편집기 이동
 *   - 카드 ⋮ → "휴지통으로 이동" / "복구" / "영구 삭제"
 *
 * admin/student 분기: mode prop으로 path 결정.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FileText, FileSpreadsheet, Presentation, ClipboardList,
  Trash2, RotateCcw, MoreVertical, AlertTriangle, Search, X,
  Globe, PanelRightOpen, PanelRightClose, Plus, ChevronDown,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { GoogleDriveSidePanel } from "./GoogleDriveSidePanel";

type ItemType = "docs" | "sheets" | "decks" | "surveys";
type TabKey = "all" | ItemType | "trash";

interface DriveItem {
  id: number;
  type: ItemType;
  title: string;
  course_id: number | null;
  owner_id: number | null;
  updated_at: string | null;
  created_at: string | null;
  deleted_at: string | null;
  storage_bytes: number;
}

interface DriveInfo {
  quota_bytes: number;
  used_bytes: number;
  available_bytes: number | null;
  usage_ratio: number;
  unlimited: boolean;
  expires_at: string | null;
  days_until_expire: number | null;
  user_type: string;
  lifecycle_status: string;
}

const TYPE_META: Record<ItemType, { label: string; icon: any; color: string; bg: string }> = {
  docs: { label: "문서", icon: FileText, color: "#1d4ed8", bg: "linear-gradient(135deg, #dbeafe 0%, #93c5fd 100%)" },
  decks: { label: "프리젠테이션", icon: Presentation, color: "#a16207", bg: "linear-gradient(135deg, #fde4b8 0%, #fbbf24 100%)" },
  surveys: { label: "설문지", icon: ClipboardList, color: "#7e22ce", bg: "linear-gradient(135deg, #ede9fe 0%, #c4b5fd 100%)" },
  sheets: { label: "스프레드시트", icon: FileSpreadsheet, color: "#107c41", bg: "linear-gradient(135deg, #d1fae5 0%, #6ee7b7 100%)" },
};

function formatMB(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function DrivePage({ mode }: { mode: "admin" | "student" }) {
  const [tab, setTab] = useState<TabKey>("all");
  const [items, setItems] = useState<DriveItem[]>([]);
  const [info, setInfo] = useState<DriveInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showGooglePanel, setShowGooglePanel] = useState(false);
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [creating, setCreating] = useState(false);
  const router = useRouter();

  const baseClassroom = mode === "admin" ? "/classroom" : "/s/classroom";
  const baseDocs = mode === "admin" ? "/docs" : "/s/docs";

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [i, list] = await Promise.all([
        api.get<DriveInfo>("/api/drive/me"),
        api.get<{ items: DriveItem[] }>(
          `/api/drive/items?trash=${tab === "trash" ? "true" : "false"}&type=${
            tab === "trash" || tab === "all" ? "all" : tab
          }`
        ),
      ]);
      setInfo(i);
      setItems(list.items);
    } catch (e: any) {
      setError(e?.message || "불러오기 실패");
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => it.title.toLowerCase().includes(q));
  }, [items, search]);

  const counts = useMemo(() => {
    if (tab === "trash") return {} as any;
    const c: any = { all: items.length };
    for (const k of ["docs", "sheets", "decks", "surveys"] as ItemType[]) {
      c[k] = items.filter((it) => it.type === k).length;
    }
    return c;
  }, [items, tab]);

  const hrefFor = (it: DriveItem): string => {
    if (it.type === "sheets") {
      return mode === "admin" ? `/sheets/${it.id}` : `/s/sheets/${it.id}`;
    }
    const segMap: Record<ItemType, string> = {
      docs: "docs",
      decks: "decks",
      surveys: "surveys",
      sheets: "sheets",
    };
    if (it.course_id) return `${baseClassroom}/${it.course_id}/${segMap[it.type]}/${it.id}`;
    if (it.type === "docs") return `${baseDocs}/${it.id}`;
    if (it.type === "decks") return `${baseDocs}/decks/${it.id}`;
    if (it.type === "surveys") return `${baseDocs}/forms/${it.id}`;
    return "#";
  };

  const doSoftDelete = async (it: DriveItem) => {
    if (!confirm(`"${it.title}"을(를) 휴지통으로 이동하시겠습니까? (30일 후 자동 영구 삭제)`)) return;
    try {
      await api.delete(`/api/drive/items/${it.type}/${it.id}`);
      await fetchAll();
    } catch (e: any) {
      alert(e?.message || "삭제 실패");
    }
  };

  const doRestore = async (it: DriveItem) => {
    try {
      await api.post(`/api/drive/items/${it.type}/${it.id}/restore`, {});
      await fetchAll();
    } catch (e: any) {
      alert(e?.message || "복구 실패");
    }
  };

  const doPermanent = async (it: DriveItem) => {
    if (!confirm(`"${it.title}"을(를) 영구 삭제합니다.\n복구 불가능. 확인하시겠습니까?`)) return;
    try {
      await api.delete(`/api/drive/items/${it.type}/${it.id}/permanent`);
      await fetchAll();
    } catch (e: any) {
      alert(e?.message || "영구 삭제 실패");
    }
  };

  const createNew = async (type: ItemType) => {
    setCreating(true);
    setShowNewMenu(false);
    try {
      const endpoints: Record<ItemType, { url: string; body: any; redirect: (id: number) => string }> = {
        docs: {
          url: "/api/classroom/docs",
          body: { title: "제목 없는 문서", course_id: null, access_mode: "specific_users" },
          redirect: (id) => (mode === "admin" ? `/docs/${id}` : `/s/docs/${id}`),
        },
        sheets: {
          url: "/api/classroom/sheets",
          body: { title: "제목 없는 스프레드시트", course_id: null, access_mode: "specific_users" },
          redirect: (id) => (mode === "admin" ? `/sheets/${id}` : `/s/sheets/${id}`),
        },
        decks: {
          url: "/api/classroom/decks",
          body: { title: "제목 없는 프리젠테이션", course_id: null, access_mode: "specific_users" },
          redirect: (id) => (mode === "admin" ? `/docs/decks/${id}` : `/s/docs/decks/${id}`),
        },
        surveys: {
          url: "/api/classroom/surveys",
          body: { title: "제목 없는 설문지", course_id: null, access_mode: "link_public", description: null },
          redirect: (id) => (mode === "admin" ? `/docs/forms/${id}` : `/s/docs/forms/${id}`),
        },
      };
      const cfg = endpoints[type];
      const r = await api.post<{ id: number }>(cfg.url, cfg.body);
      router.push(cfg.redirect(r.id));
    } catch (e: any) {
      alert(e?.message || `${TYPE_META[type].label} 생성 실패`);
    } finally {
      setCreating(false);
    }
  };

  const emptyTrash = async () => {
    if (!confirm("휴지통의 모든 자료를 영구 삭제합니다.\n복구 불가능. 진행하시겠습니까?")) return;
    try {
      const r = await api.post<{ deleted_count: number; freed_bytes: number }>(
        "/api/drive/trash/empty",
        {}
      );
      alert(`${r.deleted_count}개 자료 삭제, ${formatMB(r.freed_bytes)} 환원`);
      await fetchAll();
    } catch (e: any) {
      alert(e?.message || "휴지통 비우기 실패");
    }
  };

  // ── 사용량 게이지 색
  const gaugeColor =
    info && info.unlimited
      ? "#10b981"
      : info && info.usage_ratio >= 0.9
      ? "#dc2626"
      : info && info.usage_ratio >= 0.8
      ? "#f59e0b"
      : "#3b82f6";

  return (
    <div onClick={() => menuOpen && setMenuOpen(null)} className="flex gap-4 h-full">
      <div className="flex-1 min-w-0">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-title text-text-primary">내 드라이브</h1>
          <p className="text-caption text-text-tertiary mt-1">
            본인이 만든 문서·스프레드시트·프리젠테이션·설문지. 휴지통은 30일 후 자동 영구 삭제됩니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* "+ 신규" 드롭다운 */}
          <div className="relative">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowNewMenu(!showNewMenu); }}
              disabled={creating}
              className="px-4 py-2 text-[13px] bg-accent text-white rounded-md hover:opacity-90 flex items-center gap-1.5 disabled:opacity-50"
            >
              <Plus size={14} /> 신규 <ChevronDown size={12} />
            </button>
            {showNewMenu && (
              <div
                className="absolute right-0 top-full mt-1 z-20 bg-bg-primary border border-border-default rounded-md shadow-lg min-w-[200px] py-1"
                onClick={(e) => e.stopPropagation()}
              >
                {(["docs", "sheets", "decks", "surveys"] as ItemType[]).map((t) => {
                  const m = TYPE_META[t];
                  const Icon = m.icon;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => createNew(t)}
                      className="w-full text-left px-3 py-2 text-[13px] hover:bg-bg-secondary flex items-center gap-2 text-text-primary"
                    >
                      <Icon size={14} style={{ color: m.color }} />
                      {m.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowGooglePanel(!showGooglePanel)}
            className={`px-3 py-2 text-[12px] rounded-md flex items-center gap-1.5 ${
              showGooglePanel
                ? "bg-accent text-white"
                : "text-accent border border-accent/30 hover:bg-accent/5"
            }`}
            title="본인 Google Drive 연동"
          >
            {showGooglePanel ? <PanelRightClose size={13} /> : <PanelRightOpen size={13} />}
            <Globe size={13} /> Google Drive
          </button>
        </div>
      </div>

      {/* 만료 임박 배너 */}
      {info?.days_until_expire != null && info.days_until_expire <= 7 && (
        <div className="mb-4 flex items-start gap-2 px-3 py-2 rounded bg-amber-50 border border-amber-200">
          <AlertTriangle size={16} className="text-amber-600 mt-0.5" />
          <div className="text-[13px] text-amber-900">
            계정이 <strong>{info.days_until_expire}일 후</strong> 만료됩니다. 보관하실 자료는 미리 백업하세요.
          </div>
        </div>
      )}

      {/* Quota 게이지 */}
      {info && (
        <div className="mb-6 bg-bg-primary border border-border-default rounded-lg px-5 py-4">
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-[13px] text-text-secondary">사용량</div>
            <div className="text-[13px] text-text-secondary">
              {info.unlimited ? (
                <span className="text-emerald-600 font-semibold">무제한</span>
              ) : (
                <>
                  <span className="font-semibold text-text-primary">
                    {formatMB(info.used_bytes)}
                  </span>{" "}
                  / {formatMB(info.quota_bytes)}{" "}
                  <span className="text-text-tertiary">({Math.round(info.usage_ratio * 100)}%)</span>
                </>
              )}
            </div>
          </div>
          <div className="h-2 bg-bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full transition-all"
              style={{
                width: info.unlimited ? "100%" : `${Math.min(100, info.usage_ratio * 100)}%`,
                backgroundColor: gaugeColor,
              }}
            />
          </div>
          {!info.unlimited && info.usage_ratio >= 0.8 && (
            <div className="text-[12px] text-amber-700 mt-2">
              용량이 부족하면 휴지통을 비우거나 관리자에게 증설을 요청하세요.
            </div>
          )}
        </div>
      )}

      {/* 탭 */}
      <div className="flex items-center gap-1 border-b border-border-default mb-5">
        {([
          ["all", "전체"],
          ["docs", TYPE_META.docs.label],
          ["sheets", TYPE_META.sheets.label],
          ["decks", TYPE_META.decks.label],
          ["surveys", TYPE_META.surveys.label],
          ["trash", "휴지통"],
        ] as [TabKey, string][]).map(([key, label]) => {
          const isActive = tab === key;
          const isTrash = key === "trash";
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-[13px] border-b-2 transition whitespace-nowrap ${
                isActive
                  ? isTrash
                    ? "border-red-500 text-red-600 font-semibold"
                    : "border-accent text-accent font-semibold"
                  : "border-transparent text-text-secondary hover:text-text-primary hover:bg-bg-secondary"
              }`}
            >
              {isTrash && <Trash2 size={14} />}
              {label}
              {counts[key] != null && (
                <span className="ml-1 text-[11px] text-text-tertiary">{counts[key]}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* 검색 + 휴지통 비우기 */}
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            type="text"
            placeholder="제목 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-9 py-2 text-[13px] border border-border-default rounded-md bg-bg-primary text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary"
            >
              <X size={14} />
            </button>
          )}
        </div>
        {tab === "trash" && items.length > 0 && (
          <button
            type="button"
            onClick={emptyTrash}
            className="px-3 py-2 text-[12px] text-red-700 border border-red-300 rounded-md hover:bg-red-50"
          >
            휴지통 비우기
          </button>
        )}
      </div>

      {/* 본문 */}
      {error ? (
        <div className="text-red-600 text-body">{error}</div>
      ) : loading ? (
        <div className="text-text-tertiary">불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-bg-primary border-2 border-dashed border-border-default rounded-lg py-16 text-center">
          <div className="text-body text-text-tertiary">
            {tab === "trash" ? "휴지통이 비어있습니다" : "아직 만든 자료가 없습니다"}
          </div>
          {tab !== "trash" && (
            <div className="text-caption text-text-tertiary mt-1">
              강좌 안에서 "+ 만들기" 메뉴로 생성 가능
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((it) => {
            const m = TYPE_META[it.type];
            const Icon = m.icon;
            const menuKey = `${it.type}:${it.id}`;
            const isMenuOpen = menuOpen === menuKey;
            return (
              <div
                key={menuKey}
                className="group relative bg-bg-primary border border-border-default rounded-xl overflow-hidden hover:shadow-md transition-shadow"
              >
                {tab === "trash" ? (
                  <div className="px-4 py-6 flex items-center justify-center opacity-60" style={{ background: m.bg, minHeight: "100px" }}>
                    <Icon size={36} style={{ color: m.color }} />
                  </div>
                ) : (
                  <Link
                    href={hrefFor(it)}
                    className="block px-4 py-6 flex items-center justify-center"
                    style={{ background: m.bg, minHeight: "100px" }}
                  >
                    <Icon size={36} style={{ color: m.color }} />
                  </Link>
                )}
                <div className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      {tab === "trash" ? (
                        <div className="text-body font-medium text-text-primary truncate">{it.title}</div>
                      ) : (
                        <Link
                          href={hrefFor(it)}
                          className="text-body font-medium text-text-primary truncate hover:text-accent block"
                        >
                          {it.title}
                        </Link>
                      )}
                      <div className="text-[11px] text-text-tertiary mt-1">
                        {tab === "trash" && it.deleted_at
                          ? `삭제 ${it.deleted_at.slice(0, 16).replace("T", " ")}`
                          : it.updated_at
                          ? `수정 ${it.updated_at.slice(0, 16).replace("T", " ")}`
                          : ""}
                      </div>
                      <div className="text-[11px] text-text-tertiary mt-0.5">
                        {m.label} · {formatMB(it.storage_bytes)}
                      </div>
                    </div>
                    {/* ⋮ 메뉴 */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpen(isMenuOpen ? null : menuKey);
                        }}
                        className="p-1 rounded hover:bg-bg-secondary text-text-tertiary"
                      >
                        <MoreVertical size={14} />
                      </button>
                      {isMenuOpen && (
                        <div
                          className="absolute right-0 top-full mt-1 z-10 bg-bg-primary border border-border-default rounded-md shadow-lg min-w-[140px] py-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {tab === "trash" ? (
                            <>
                              <button
                                type="button"
                                onClick={() => { setMenuOpen(null); doRestore(it); }}
                                className="w-full text-left px-3 py-2 text-[12px] hover:bg-bg-secondary flex items-center gap-2"
                              >
                                <RotateCcw size={12} /> 복구
                              </button>
                              <button
                                type="button"
                                onClick={() => { setMenuOpen(null); doPermanent(it); }}
                                className="w-full text-left px-3 py-2 text-[12px] hover:bg-red-50 text-red-600 flex items-center gap-2"
                              >
                                <Trash2 size={12} /> 영구 삭제
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => { setMenuOpen(null); doSoftDelete(it); }}
                              className="w-full text-left px-3 py-2 text-[12px] hover:bg-red-50 text-red-600 flex items-center gap-2"
                            >
                              <Trash2 size={12} /> 휴지통으로 이동
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      </div>

      {/* Google Drive 사이드 패널 */}
      {showGooglePanel && (
        <div className="w-[360px] flex-shrink-0 hidden lg:block">
          <GoogleDriveSidePanel onClose={() => setShowGooglePanel(false)} />
        </div>
      )}
    </div>
  );
}
