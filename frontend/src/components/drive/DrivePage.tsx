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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FileText, FileSpreadsheet, Presentation, ClipboardList,
  Trash2, RotateCcw, MoreVertical, AlertTriangle, Search, X,
  Globe, PanelRightOpen, PanelRightClose, Plus, ChevronDown,
  LayoutGrid, List as ListIcon, FileType2,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { GoogleDriveSidePanel } from "./GoogleDriveSidePanel";
import { ShareFromDrive } from "./ShareFromDrive";
import { BulkActionBar } from "./BulkActionBar";
import { DriveContextMenu } from "./DriveContextMenu";
import { FolderSidebar } from "./FolderSidebar";
import { MoveToFolderModal } from "./MoveToFolderModal";

type ItemType = "docs" | "sheets" | "decks" | "surveys" | "hwps";
type TabKey = "all" | ItemType | "trash";

interface DriveItem {
  id: number;
  type: ItemType;
  title: string;
  course_id: number | null;
  owner_id: number | null;
  folder_id: number | null;
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
  hwps: { label: "한컴 문서", icon: FileType2, color: "#0891b2", bg: "linear-gradient(135deg, #cffafe 0%, #67e8f9 100%)" },
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
  const [panelWidth, setPanelWidth] = useState<number>(360);
  const [resizing, setResizing] = useState(false);
  // localStorage 복원
  useEffect(() => {
    const saved = Number(localStorage.getItem("drive.googlePanelWidth"));
    if (saved && saved >= 280 && saved <= 1000) setPanelWidth(saved);
  }, []);
  // 드래그 중 mousemove 핸들러
  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      const w = window.innerWidth - e.clientX;
      const clamped = Math.max(280, Math.min(window.innerWidth - 400, w));
      setPanelWidth(clamped);
    };
    const onUp = () => {
      setResizing(false);
      // 종료 시 저장
      setPanelWidth((cur) => {
        localStorage.setItem("drive.googlePanelWidth", String(cur));
        return cur;
      });
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resizing]);
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [creating, setCreating] = useState(false);
  const router = useRouter();

  // Google Drive 식 다중 선택 + 우클릭 메뉴 state
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastKey, setLastKey] = useState<string | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; target: DriveItem | null } | null>(null);
  const [shareTarget, setShareTarget] = useState<DriveItem | null>(null);

  // Rubber band drag 선택 — 빈영역에서 마우스 드래그로 박스 그어 다중 선택
  const [dragBox, setDragBox] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const dragStartRef = useRef<{
    x: number; y: number; base: Set<string>; additive: boolean; started: boolean;
  } | null>(null);

  // 이름 바꾸기 (F2 / 우클릭 메뉴) — 현재 편집 중인 키 + draft
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  // 폴더 — 현재 보기 폴더 (undefined=전체, null=폴더 밖, number=그 폴더 안)
  const [currentFolderId, setCurrentFolderId] = useState<number | null | undefined>(undefined);
  const [moveTargets, setMoveTargets] = useState<DriveItem[] | null>(null);
  // 사이드바 표시 토글 (사용자 preference localStorage)
  const [showFolderSidebar, setShowFolderSidebar] = useState<boolean>(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem("drive.showFolderSidebar");
    if (saved === "false") setShowFolderSidebar(false);
  }, []);
  useEffect(() => {
    try { localStorage.setItem("drive.showFolderSidebar", String(showFolderSidebar)); } catch {}
  }, [showFolderSidebar]);

  const itemKey = (it: DriveItem) => `${it.type}:${it.id}`;

  // 박스 + 카드 rect intersect 검사
  const intersects = (a: DOMRect, box: { x1: number; y1: number; x2: number; y2: number }) => {
    const bx1 = Math.min(box.x1, box.x2);
    const by1 = Math.min(box.y1, box.y2);
    const bx2 = Math.max(box.x1, box.x2);
    const by2 = Math.max(box.y1, box.y2);
    return !(a.right < bx1 || a.left > bx2 || a.bottom < by1 || a.top > by2);
  };

  // 드래그 시작 (빈 영역 onMouseDown). 단순 클릭이어도 — Ctrl/Shift 없으면
  // 그 시점에 즉시 선택 해제 (사용자가 여백 클릭하면 블록 풀려야).
  const startRubberBand = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // 좌클릭만
    const target = e.target as HTMLElement;
    if (target.closest("[data-drive-card]") || target.closest("[data-drive-row]")) return;
    if (target.closest("button, a, input, select, textarea")) return;
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    if (!additive) setSelected(new Set()); // 빈영역 클릭만으로도 해제
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      base: additive ? new Set(selected) : new Set(),
      additive,
      started: false,
    };
  };

  // 마우스 move/up 글로벌 리스너 — mount 시 한 번만 등록 (stale closure 회피).
  // dragBox state는 visual only — 로직은 dragStartRef.started 플래그로 추적.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const s = dragStartRef.current;
      if (!s) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      // 첫 3px 이하면 박스 시작 안 함 (단순 클릭과 구분). 한 번 시작되면 계속 update.
      if (!s.started) {
        if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
        s.started = true;
      }
      const box = { x1: s.x, y1: s.y, x2: e.clientX, y2: e.clientY };
      setDragBox(box);
      const nodes = document.querySelectorAll<HTMLElement>("[data-drive-key]");
      const hit = new Set(s.base);
      nodes.forEach((n) => {
        const key = n.dataset.driveKey;
        if (!key) return;
        if (intersects(n.getBoundingClientRect(), box)) hit.add(key);
        else if (!s.additive) hit.delete(key);
      });
      setSelected(hit);
    };
    const onUp = () => {
      if (dragStartRef.current) {
        dragStartRef.current = null;
        setDragBox(null);
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);
  // 보기 모드 — 사용자 preference localStorage 보존, 기본은 list (자세히)
  const [viewMode, setViewMode] = useState<"list" | "grid">(() => {
    if (typeof window === "undefined") return "list";
    const saved = localStorage.getItem("drive.viewMode");
    return saved === "grid" ? "grid" : "list";
  });
  const changeViewMode = (m: "list" | "grid") => {
    setViewMode(m);
    try { localStorage.setItem("drive.viewMode", m); } catch {}
  };

  const baseClassroom = mode === "admin" ? "/classroom" : "/s/classroom";
  const baseDocs = mode === "admin" ? "/docs" : "/s/docs";

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const folderQS =
        currentFolderId === undefined
          ? ""
          : currentFolderId === null
          ? "&no_folder=true"
          : `&folder_id=${currentFolderId}`;
      const [i, list] = await Promise.all([
        api.get<DriveInfo>("/api/drive/me"),
        api.get<{ items: DriveItem[] }>(
          `/api/drive/items?trash=${tab === "trash" ? "true" : "false"}&type=all${folderQS}`
        ),
      ]);
      setInfo(i);
      setItems(list.items);
    } catch (e: any) {
      setError(e?.message || "불러오기 실패");
    } finally {
      setLoading(false);
    }
  }, [tab, currentFolderId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = items;
    // 휴지통/전체가 아니면 해당 type만 표시
    if (tab !== "all" && tab !== "trash") {
      list = list.filter((it) => it.type === tab);
    }
    if (q) {
      list = list.filter((it) => it.title.toLowerCase().includes(q));
    }
    return list;
  }, [items, search, tab]);

  const counts = useMemo(() => {
    if (tab === "trash") return {} as any;
    const c: any = { all: items.length };
    for (const k of ["docs", "sheets", "decks", "surveys", "hwps"] as ItemType[]) {
      c[k] = items.filter((it) => it.type === k).length;
    }
    return c;
  }, [items, tab]);

  const hrefFor = (it: DriveItem): string => {
    if (it.type === "sheets") {
      return mode === "admin" ? `/sheets/${it.id}` : `/s/sheets/${it.id}`;
    }
    if (it.type === "hwps") {
      return mode === "admin" ? `/hwps/${it.id}` : `/s/hwps/${it.id}`;
    }
    const segMap: Record<ItemType, string> = {
      docs: "docs",
      decks: "decks",
      surveys: "surveys",
      sheets: "sheets",
      hwps: "hwps",
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

  // ── 다중 선택 / 일괄 액션 — Google Drive 식: 클릭=선택, 더블클릭=열기 ──
  const handleItemClick = (it: DriveItem, e: React.MouseEvent) => {
    const key = itemKey(it);
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      setLastKey(key);
      return;
    }
    if (e.shiftKey && lastKey) {
      e.preventDefault();
      const start = filtered.findIndex((x) => itemKey(x) === lastKey);
      const end = filtered.findIndex((x) => itemKey(x) === key);
      if (start >= 0 && end >= 0) {
        const [a, b] = start < end ? [start, end] : [end, start];
        setSelected((prev) => {
          const next = new Set(prev);
          for (let i = a; i <= b; i++) next.add(itemKey(filtered[i]));
          return next;
        });
      }
      return;
    }
    // 일반 클릭 — 단일 선택 (열기는 더블 클릭)
    e.preventDefault();
    setSelected(new Set([key]));
    setLastKey(key);
  };

  const handleItemDoubleClick = (it: DriveItem, e: React.MouseEvent) => {
    if (tab === "trash") return; // 휴지통에선 더블클릭으로 안 열림
    e.preventDefault();
    router.push(hrefFor(it));
  };

  const handleItemContextMenu = (it: DriveItem | null, e: React.MouseEvent) => {
    e.preventDefault();
    if (it) {
      const key = itemKey(it);
      if (!selected.has(key)) {
        // 선택 안 된 항목 우클릭 → 그 항목 단일 선택
        setSelected(new Set([key]));
        setLastKey(key);
      }
    } else {
      // 빈 영역 우클릭 → 선택 해제 + "새로 만들기" 메뉴
      setSelected(new Set());
    }
    setCtx({ x: e.clientX, y: e.clientY, target: it });
  };

  const doBulkAction = async (
    action: (it: DriveItem) => Promise<void>,
    label: string,
    needConfirm: boolean,
  ) => {
    if (selected.size === 0) return;
    if (needConfirm && !confirm(`${selected.size}개 항목을 ${label}합니다.`)) return;
    const targets = items.filter((it) => selected.has(itemKey(it)));
    for (const it of targets) {
      try { await action(it); } catch { /* skip 실패 */ }
    }
    setSelected(new Set());
    await fetchAll();
  };

  const doBulkSoftDelete = () => doBulkAction(
    async (it) => { await api.delete(`/api/drive/items/${it.type}/${it.id}`); },
    "휴지통으로 이동", true,
  );
  const doBulkPermanent = () => doBulkAction(
    async (it) => { await api.delete(`/api/drive/items/${it.type}/${it.id}/permanent`); },
    "영구 삭제 (복구 불가)", true,
  );
  const doBulkRestore = () => doBulkAction(
    async (it) => { await api.post(`/api/drive/items/${it.type}/${it.id}/restore`, {}); },
    "복구", false,
  );

  // Esc / Delete 키 처리
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // input/textarea 안에서는 동작 X
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      if (e.key === "Escape") {
        setSelected(new Set());
        setCtx(null);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selected.size > 0) {
        e.preventDefault();
        if (tab === "trash") doBulkPermanent();
        else doBulkSoftDelete();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, tab]);

  // 이름 바꾸기
  const RENAME_PATH: Partial<Record<ItemType, string>> = {
    docs: "/api/classroom/docs",
    sheets: "/api/classroom/sheets",
    decks: "/api/classroom/decks",
    surveys: "/api/classroom/surveys",
    hwps: "/api/classroom/hwps",
  };

  const startRename = (it: DriveItem) => {
    setRenamingKey(itemKey(it));
    setRenameDraft(it.title);
  };

  const commitRename = async (it: DriveItem) => {
    const next = renameDraft.trim();
    setRenamingKey(null);
    if (!next || next === it.title) return;
    const base = RENAME_PATH[it.type];
    if (!base) return;
    try {
      await api.put(`${base}/${it.id}`, { title: next });
      await fetchAll();
    } catch (e: any) {
      alert(e?.detail || "이름 바꾸기 실패");
    }
  };

  // F2 / Enter 단축키 — 단일 선택 시 이름 바꾸기 시작
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      if ((e.key === "F2" || e.key === "Enter") && selected.size === 1 && !renamingKey) {
        const onlyKey = Array.from(selected)[0];
        const it = items.find((x) => itemKey(x) === onlyKey);
        if (it && tab !== "trash") {
          e.preventDefault();
          startRename(it);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, items, tab, renamingKey]);

  const createNew = async (type: ItemType) => {
    setCreating(true);
    setShowNewMenu(false);
    try {
      if (type === "surveys") {
        // 단독 설문지 페이지는 추후 (설문 빌더 복잡도 큼) — 강좌 안 빌더로 안내
        alert("단독 설문지 생성은 추후 지원 예정입니다.\n현재는 클래스룸 → 강좌 → '+ 만들기 → 설문지'로 만들어주세요.");
        return;
      }
      const endpoints: Partial<Record<ItemType, { url: string; body: any; redirect: (id: number) => string }>> = {
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
        hwps: {
          url: "/api/classroom/hwps",
          body: { title: "제목 없는 한컴 문서", course_id: null, access_mode: "specific_users" },
          redirect: (id) => (mode === "admin" ? `/hwps/${id}` : `/s/hwps/${id}`),
        },
      };
      const cfg = endpoints[type]!;
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
    // -m-6 으로 admin/student layout의 main p-6 padding을 상쇄하여 viewport 가득 채움
    <div
      onClick={(e) => {
        if (menuOpen) setMenuOpen(null);
        // 빈영역 클릭 시 선택 해제 (단, 컨트롤 키 누른 상태에선 무시)
        if (e.target === e.currentTarget && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
          setSelected(new Set());
        }
        setCtx(null);
      }}
      onContextMenu={(e) => {
        // 컨테이너(빈영역) 우클릭만 잡음 — 자식의 contextmenu가 stopPropagation
        if (e.target === e.currentTarget) handleItemContextMenu(null, e);
      }}
      className="-m-6 flex h-screen overflow-hidden bg-bg-secondary"
    >
      {/* 좌측 폴더 사이드바 */}
      {showFolderSidebar && (
        <FolderSidebar
          currentFolderId={currentFolderId}
          onSelect={(fid) => setCurrentFolderId(fid)}
          onRefresh={fetchAll}
        />
      )}

      <div
        className="flex-1 min-w-0 flex flex-col p-6 relative select-none"
        onMouseDown={startRubberBand}
        onContextMenu={(e) => {
          // 카드 외부 (테이블 패딩 등) 빈 영역 우클릭
          const target = e.target as HTMLElement;
          if (!target.closest("[data-drive-row]") && !target.closest("[data-drive-card]")) {
            handleItemContextMenu(null, e);
          }
        }}
      >
      {/* 헤더 영역 — 스크롤 안 됨 (flex-shrink-0) */}
      <div className="flex-shrink-0">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={() => setShowFolderSidebar((v) => !v)}
            className="mt-1 p-1.5 rounded hover:bg-bg-secondary text-text-tertiary"
            title={showFolderSidebar ? "폴더 사이드바 숨기기" : "폴더 사이드바 보이기"}
          >
            <ListIcon size={16} />
          </button>
          <div>
            <h1 className="text-title text-text-primary">내 드라이브</h1>
            <p className="text-caption text-text-tertiary mt-1">
              {currentFolderId === null
                ? "폴더 밖 자료 — 좌측에서 폴더를 선택하세요."
                : currentFolderId === undefined
                ? "본인이 만든 문서·스프레드시트·프리젠테이션·설문지·한컴 문서. 휴지통은 30일 후 자동 영구 삭제됩니다."
                : "선택된 폴더 안 자료입니다."}
            </p>
          </div>
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
                {(["docs", "sheets", "decks", "surveys", "hwps"] as ItemType[]).map((t) => {
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
          ["hwps", TYPE_META.hwps.label],
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
        {/* 보기 모드 토글 */}
        <div className="ml-auto flex items-center border border-border-default rounded-md overflow-hidden">
          <button
            type="button"
            onClick={() => changeViewMode("list")}
            className={`p-1.5 ${viewMode === "list" ? "bg-accent text-white" : "text-text-tertiary hover:bg-bg-secondary"}`}
            title="자세히 보기"
          >
            <ListIcon size={14} />
          </button>
          <button
            type="button"
            onClick={() => changeViewMode("grid")}
            className={`p-1.5 border-l border-border-default ${viewMode === "grid" ? "bg-accent text-white" : "text-text-tertiary hover:bg-bg-secondary"}`}
            title="카드 보기"
          >
            <LayoutGrid size={14} />
          </button>
        </div>
      </div>

      </div>{/* /헤더 영역 (flex-shrink-0) */}

      {/* 파일 list 영역 — 자체 스크롤 (Google Drive 식) */}
      <div className="flex-1 overflow-y-auto min-h-0 -mx-6 px-6 pb-6">
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
      ) : viewMode === "list" ? (
        /* 자세히(리스트) 뷰 — 구글 드라이브 식 */
        <div className="bg-bg-primary border border-border-default rounded-lg overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-bg-secondary border-b border-border-default text-text-tertiary sticky top-0 z-10">
              <tr>
                <th className="px-4 py-2 text-left font-medium w-10"></th>
                <th className="px-2 py-2 text-left font-medium">이름</th>
                <th className="px-2 py-2 text-left font-medium w-32">유형</th>
                <th className="px-2 py-2 text-left font-medium w-40">
                  {tab === "trash" ? "삭제일" : "수정일"}
                </th>
                <th className="px-2 py-2 text-right font-medium w-24">크기</th>
                <th className="px-2 py-2 w-12"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((it) => {
                const m = TYPE_META[it.type];
                const Icon = m.icon;
                const menuKey = `${it.type}:${it.id}`;
                const isMenuOpen = menuOpen === menuKey;
                const isSelected = selected.has(menuKey);
                const dateStr = tab === "trash"
                  ? it.deleted_at?.slice(0, 16).replace("T", " ") || ""
                  : it.updated_at?.slice(0, 16).replace("T", " ") || "";
                return (
                  <tr
                    key={menuKey}
                    data-drive-row
                    data-drive-key={menuKey}
                    className={`border-b border-border-default/50 cursor-pointer ${
                      isSelected ? "bg-[#e8def8] hover:bg-[#d7c4f3]" : "hover:bg-bg-secondary/50"
                    }`}
                    onClick={(e) => handleItemClick(it, e)}
                    onDoubleClick={(e) => handleItemDoubleClick(it, e)}
                    onContextMenu={(e) => handleItemContextMenu(it, e)}
                  >
                    <td className="px-4 py-2">
                      <Icon size={18} style={{ color: m.color }} />
                    </td>
                    <td className="px-2 py-2">
                      {renamingKey === menuKey ? (
                        <input
                          autoFocus
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onBlur={() => commitRename(it)}
                          onClick={(e) => e.stopPropagation()}
                          onDoubleClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); commitRename(it); }
                            else if (e.key === "Escape") { e.preventDefault(); setRenamingKey(null); }
                          }}
                          className="px-2 py-0.5 border border-accent rounded outline-none bg-white text-text-primary w-full max-w-md"
                        />
                      ) : (
                        <span className="text-text-primary">{it.title}</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-text-secondary">{m.label}</td>
                    <td className="px-2 py-2 text-text-tertiary">{dateStr}</td>
                    <td className="px-2 py-2 text-right text-text-tertiary">{formatMB(it.storage_bytes)}</td>
                    <td className="px-2 py-2 text-right">
                      <div className="relative inline-block">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setMenuOpen(isMenuOpen ? null : menuKey); }}
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((it) => {
            const m = TYPE_META[it.type];
            const Icon = m.icon;
            const menuKey = `${it.type}:${it.id}`;
            const isMenuOpen = menuOpen === menuKey;
            const isSelected = selected.has(menuKey);
            return (
              <div
                key={menuKey}
                data-drive-card
                data-drive-key={menuKey}
                className={`group relative border-2 rounded-xl overflow-hidden hover:shadow-md transition-all cursor-pointer ${
                  isSelected
                    ? "border-[#673ab7] bg-[#e8def8] shadow-md"
                    : "border-border-default bg-bg-primary"
                }`}
                onClick={(e) => handleItemClick(it, e)}
                onDoubleClick={(e) => handleItemDoubleClick(it, e)}
                onContextMenu={(e) => { e.stopPropagation(); handleItemContextMenu(it, e); }}
              >
                <div
                  className={`px-4 py-6 flex items-center justify-center ${tab === "trash" ? "opacity-60" : ""}`}
                  style={{ background: m.bg, minHeight: "100px" }}
                >
                  <Icon size={36} style={{ color: m.color }} />
                </div>
                <div className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      {renamingKey === menuKey ? (
                        <input
                          autoFocus
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onBlur={() => commitRename(it)}
                          onClick={(e) => e.stopPropagation()}
                          onDoubleClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); commitRename(it); }
                            else if (e.key === "Escape") { e.preventDefault(); setRenamingKey(null); }
                          }}
                          className="px-2 py-0.5 border border-accent rounded outline-none bg-white text-text-primary w-full"
                        />
                      ) : (
                        <div className="text-body font-medium text-text-primary truncate">{it.title}</div>
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
      </div>{/* /파일 list 영역 (flex-1 overflow-y-auto) */}
      </div>{/* /좌측 main (flex flex-col) */}

      {/* 좌우 splitter (드래그로 패널 크기 조절) */}
      {showGooglePanel && (
        <div
          role="separator"
          aria-label="좌우 패널 크기 조절"
          onMouseDown={(e) => { e.preventDefault(); setResizing(true); }}
          className={`w-[6px] cursor-col-resize flex-shrink-0 transition-colors ${
            resizing ? "bg-accent" : "bg-bg-secondary hover:bg-accent/50"
          }`}
          title="드래그하여 좌우 크기 조절"
        />
      )}

      {/* Google Drive 사이드 패널 — 동적 width */}
      {showGooglePanel && (
        <div
          className="flex-shrink-0 h-full overflow-hidden"
          style={{ width: panelWidth }}
        >
          <GoogleDriveSidePanel onClose={() => setShowGooglePanel(false)} />
        </div>
      )}

      {/* Rubber band drag 박스 — viewport 기준 fixed */}
      {dragBox && (
        <div
          className="fixed pointer-events-none z-20"
          style={{
            left: Math.min(dragBox.x1, dragBox.x2),
            top: Math.min(dragBox.y1, dragBox.y2),
            width: Math.abs(dragBox.x2 - dragBox.x1),
            height: Math.abs(dragBox.y2 - dragBox.y1),
            border: "1px solid #673ab7",
            background: "rgba(103, 58, 183, 0.15)",
          }}
        />
      )}

      {/* 다중 선택 액션 바 */}
      <BulkActionBar
        count={selected.size}
        trashTab={tab === "trash"}
        onClear={() => setSelected(new Set())}
        onSoftDelete={doBulkSoftDelete}
        onRestore={doBulkRestore}
        onPermanent={doBulkPermanent}
      />

      {/* 우클릭 컨텍스트 메뉴 */}
      {ctx && (
        <DriveContextMenu
          x={ctx.x}
          y={ctx.y}
          target={ctx.target}
          selectedCount={selected.size}
          trashTab={tab === "trash"}
          newMenu={(["docs", "sheets", "decks", "surveys", "hwps"] as ItemType[]).map((t) => ({
            type: t,
            meta: { label: TYPE_META[t].label, icon: TYPE_META[t].icon, color: TYPE_META[t].color },
          }))}
          onOpen={(it) => router.push(hrefFor(it as DriveItem))}
          onOpenNewWindow={(it) => {
            const seg =
              it.type === "decks" ? "decks"
              : it.type === "sheets" ? "sheets"
              : it.type === "hwps" ? "hwps"
              : "docs";
            window.open(`/embed/${seg}/${it.id}`, "_blank");
          }}
          onRename={(it) => startRename(it as DriveItem)}
          onShare={(it) => setShareTarget(it as DriveItem)}
          onSoftDelete={doBulkSoftDelete}
          onRestore={doBulkRestore}
          onPermanent={doBulkPermanent}
          onMove={() => {
            // 선택된 자료 모두 이동 모달로
            const sel = items.filter((it) => selected.has(`${it.type}:${it.id}`));
            const target = ctx?.target ? [ctx.target as DriveItem] : [];
            setMoveTargets(sel.length > 0 ? sel : target);
          }}
          onCreateNew={(t) => createNew(t)}
          onClose={() => setCtx(null)}
        />
      )}

      {/* 공유 모달 — 도구별 ShareDocModal 재사용 */}
      {shareTarget && (
        <ShareFromDrive
          target={{ type: shareTarget.type, id: shareTarget.id, title: shareTarget.title }}
          onClose={() => setShareTarget(null)}
          onChanged={fetchAll}
        />
      )}

      {/* 폴더 이동 모달 */}
      {moveTargets && moveTargets.length > 0 && (
        <MoveToFolderModal
          targets={moveTargets.map((it) => ({ type: it.type, id: it.id, title: it.title }))}
          onClose={() => setMoveTargets(null)}
          onMoved={() => {
            setSelected(new Set());
            fetchAll();
          }}
        />
      )}
    </div>
  );
}
