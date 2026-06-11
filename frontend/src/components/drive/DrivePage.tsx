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

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Trash2,
  Globe, PanelRightOpen, PanelRightClose,
  LayoutGrid, List as ListIcon,
  ChevronRight,
  Sparkles, Activity,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { useToast } from "@/components/ui/Toast";
import { useAIAssistant } from "@/lib/ai-assistant-context";
import { AIAssistantPanel } from "@/components/tool-ai/AIAssistantPanel";
import { GoogleDriveSidePanel } from "./GoogleDriveSidePanel";
import { ShareFromDrive } from "./ShareFromDrive";
import { BulkActionBar } from "./BulkActionBar";
import { DriveContextMenu } from "./DriveContextMenu";
import { MoveToFolderModal } from "./MoveToFolderModal";
import { DriveProposalModal, type ProposalAction } from "./DriveProposalModal";
import { DriveActivityModal } from "./DriveActivityModal";
import {
  TYPE_META, formatMB, hrefForItem, buildDriveContext,
  type ItemType, type SortKey, type SortDir,
  type DriveItem,
} from "./_drive-shared";
import { useDriveKeyboardShortcuts } from "./useDriveKeyboardShortcuts";
import { useDriveRubberBand } from "./useDriveRubberBand";
import { useDriveSearch } from "./useDriveSearch";
import { useSearchHistory } from "./useSearchHistory";
import { useDriveFetch } from "./useDriveFetch";
import { useDriveRename } from "./useDriveRename";
import { useDriveDragDrop } from "./useDriveDragDrop";
import { DriveBackupActions } from "./DriveBackupActions";
import { DriveListView } from "./DriveListView";
import { DriveGridView } from "./DriveGridView";
import { NewItemMenu } from "./NewItemMenu";
import { DriveSearchBar } from "./DriveSearchBar";
import { DriveQuotaGauge } from "./DriveQuotaGauge";
import type { FolderNode } from "./FolderSidebar";

export function DrivePage({ mode }: { mode: "admin" | "student" }) {
  // 휴지통 모드 (탭 대신 단순 boolean)
  const [trashMode, setTrashMode] = useState(false);
  // 폴더 — 현재 보기 폴더 (null = 루트, number = 그 폴더 안)
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
  // ── fetch state (useDriveFetch hook) ──
  const {
    items, folders, breadcrumb, info,
    loading, error,
    fetchAll,
    favoritesSet, toggleFavorite,
  } = useDriveFetch({ trashMode, currentFolderId });
  // 정렬
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  // 잘라내기/복사 (Ctrl+X/C) — itemKey set. Ctrl+V로 현재 폴더에 붙여넣기.
  // clipMode: 'cut' = 이동(move), 'copy' = 복제(copy)
  const [cutKeys, setCutKeys] = useState<Set<string>>(new Set());
  const [clipMode, setClipMode] = useState<"cut" | "copy">("cut");
  const [search, setSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
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
  const toast = useToast();
  const ai = useAIAssistant();

  // Drive AI 패널
  const [showAI, setShowAI] = useState(false);
  const [proposal, setProposal] = useState<{ summary: string; actions: ProposalAction[] } | null>(null);
  const [showActivity, setShowActivity] = useState(false);
  // AI 분석용 전체 드라이브 스냅샷 (현재 폴더 무관) — AI 켤 때만 fetch
  const [aiSnapshotItems, setAiSnapshotItems] = useState<DriveItem[]>([]);
  const [aiSnapshotFolders, setAiSnapshotFolders] = useState<FolderNode[]>([]);
  useEffect(() => {
    if (!showAI) return;
    (async () => {
      try {
        const [a, f] = await Promise.all([
          api.get<{ items: DriveItem[] }>("/api/drive/items?trash=false&type=all"),
          api.get<{ items: FolderNode[] }>("/api/drive/folders"),
        ]);
        setAiSnapshotItems(a.items);
        setAiSnapshotFolders(f.items);
      } catch {}
    })();
  }, [showAI]);

  // 페이지 진입 시 AI 패널 잔여 state 클리어
  useEffect(() => { ai.setOpen(false); /* eslint-disable-next-line */ }, []);

  // Google Drive 식 다중 선택 + 우클릭 메뉴 state
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastKey, setLastKey] = useState<string | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; target: DriveItem | null } | null>(null);
  const [shareTarget, setShareTarget] = useState<DriveItem | null>(null);

  // Rubber band drag — useDriveRubberBand hook으로 분리 (line ↓)

  const [moveTargets, setMoveTargets] = useState<DriveItem[] | null>(null);

  const itemKey = (it: DriveItem) => `${it.type}:${it.id}`;

  // 빈영역 드래그 박스 다중 선택 — useDriveRubberBand
  const { dragBox, startRubberBand } = useDriveRubberBand({ selected, setSelected });

  // 드래그&드롭 — 폴더 hover state + drop handler (useDriveDragDrop)
  const {
    dragOverFolderId, onDragOverFolder, onDragLeaveFolder, onDrop: onFolderDrop,
  } = useDriveDragDrop({ fetchAll, setSelected });

  // backend 검색 — 본문/제목/폴더 통합 검색 (debounce 400ms, 2자 이상)
  const driveSearch = useDriveSearch(search, trashMode);
  const searchHistory = useSearchHistory();
  // 검색 결과 도달 시 히스토리 자동 기록
  useEffect(() => {
    if (driveSearch.results && driveSearch.results.total > 0) {
      searchHistory.record(search);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driveSearch.results?.query]);

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


  // 검색 모드 (backend 결과) vs 일반 모드 (현재 폴더 자료)
  // - driveSearch.active=true: 본문/제목/폴더 backend 검색 결과 사용 (전체 드라이브)
  // - false: 현재 폴더 안 자료만 (client-side 정렬)
  const searchActive = driveSearch.active && !!driveSearch.results;
  const searchResults = driveSearch.results;

  // 정렬 적용 후 자료 목록
  const filtered = useMemo(() => {
    if (searchActive && searchResults) {
      // backend 결과 → DriveItem 호환 형식으로 매핑
      return searchResults.items.map((r): DriveItem => ({
        id: r.id,
        type: r.type,
        title: r.title,
        course_id: r.course_id,
        owner_id: null,
        folder_id: r.folder_id,
        updated_at: r.updated_at,
        created_at: null,
        deleted_at: null,
        storage_bytes: 0,
      }));
    }
    // 일반 모드 — title client-side filter (검색어 짧을 때 fallback)
    const q = search.trim().toLowerCase();
    let list = items.slice();
    if (q) list = list.filter((it) => it.title.toLowerCase().includes(q));
    const cmp = (a: DriveItem, b: DriveItem) => {
      let v = 0;
      if (sortKey === "name") {
        v = a.title.localeCompare(b.title, "ko");
      } else if (sortKey === "updated") {
        v = (a.updated_at || "").localeCompare(b.updated_at || "");
      } else if (sortKey === "size") {
        v = (a.storage_bytes || 0) - (b.storage_bytes || 0);
      } else if (sortKey === "owner") {
        v = String(a.owner_id ?? "").localeCompare(String(b.owner_id ?? ""));
      }
      return sortDir === "asc" ? v : -v;
    };
    list.sort(cmp);
    return list;
  }, [items, search, sortKey, sortDir, searchActive, searchResults]);

  // 정렬된 폴더 (검색 모드면 backend 결과 사용)
  const filteredFolders = useMemo(() => {
    if (searchActive && searchResults) {
      return searchResults.folders.map((f) => ({
        id: f.id,
        owner_id: 0,
        parent_id: f.parent_id,
        name: f.name,
        auto_kind: null,
        semester_id: null,
        source_kind: null,
        source_id: null,
        sort_order: f.sort_order,
        is_system_locked: f.is_system_locked,
      } as FolderNode));
    }
    const q = search.trim().toLowerCase();
    let list = folders.slice();
    if (q) list = list.filter((f) => f.name.toLowerCase().includes(q));
    const cmp = (a: FolderNode, b: FolderNode) => {
      let v = 0;
      if (sortKey === "name") {
        if (a.is_system_locked && b.is_system_locked) v = a.sort_order - b.sort_order;
        else if (a.is_system_locked) v = -1;
        else if (b.is_system_locked) v = 1;
        else v = a.name.localeCompare(b.name, "ko");
      } else if (sortKey === "updated") {
        v = String((a as any).updated_at || "").localeCompare(String((b as any).updated_at || ""));
      } else {
        v = a.name.localeCompare(b.name, "ko");
      }
      return sortDir === "asc" ? v : -v;
    };
    list.sort(cmp);
    return list;
  }, [folders, search, sortKey, sortDir, searchActive, searchResults]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const hrefFor = (it: DriveItem): string => hrefForItem(it, mode);

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
    if (trashMode) return; // 휴지통에선 더블클릭으로 안 열림
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

  // Esc / Delete / Ctrl(Cmd)+X / Ctrl(Cmd)+C / Ctrl(Cmd)+V / Ctrl(Cmd)+A
  useDriveKeyboardShortcuts({
    trashMode, selected, setSelected, cutKeys, setCutKeys, clipMode, setClipMode,
    setCtx: () => setCtx(null),
    items, filtered, filteredFolders, currentFolderId,
    fetchAll, doBulkSoftDelete, doBulkPermanent, toast,
  });

  // 이름 바꾸기 — F2/Enter 단축키 + commitRename hook
  const {
    renamingKey, renameDraft, setRenameDraft,
    startRename, cancelRename, commitRename,
  } = useDriveRename({ selected, items, trashMode, fetchAll });

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
        word_decks: {
          url: "/api/tools/wordbook/decks",
          body: { title: "제목 없는 단어장" },
          redirect: (id) => `/tools/wordbook/${id}`,
        },
        boards: {
          url: "/api/classroom/boards",
          body: { title: "제목 없는 보드" },
          redirect: (id) => `/tools/board/${id}`,
        },
      };
      const cfg = endpoints[type]!;
      const r = await api.post<{ id: number }>(cfg.url, cfg.body);
      // 현재 폴더 안이면 자동 배치 (best-effort)
      if (currentFolderId !== null && r.id) {
        try {
          await api.post(`/api/drive/items/${type}/${r.id}/move`, {
            folder_id: currentFolderId,
          });
        } catch {}
      }
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

  // ── DriveListView / DriveGridView에 전달할 단일 객체 props (drilling 압축)
  const selectionProps = {
    selected, setSelected, cutKeys, favoritesSet, toggleFavorite,
    menuOpen, setMenuOpen,
    onItemClick: handleItemClick,
    onItemDoubleClick: handleItemDoubleClick,
    onItemContextMenu: handleItemContextMenu,
    onSoftDelete: doSoftDelete,
    onRestore: doRestore,
    onPermanent: doPermanent,
    items, itemKey,
  };
  const renameProps = {
    renamingKey, renameDraft, setRenameDraft, commitRename, cancelRename,
  };
  const dragDropProps = {
    dragOverFolderId, onDragOverFolder, onDragLeaveFolder, onDrop: onFolderDrop,
  };

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
        <div className="min-w-0">
          {/* Google Drive 식 breadcrumb */}
          <div className="flex items-center gap-1 text-title text-text-primary min-w-0">
            <button
              type="button"
              onClick={() => { setTrashMode(false); setCurrentFolderId(null); }}
              className="hover:underline truncate"
            >
              내 드라이브
            </button>
            {trashMode && (
              <>
                <ChevronRight size={16} className="text-text-tertiary flex-shrink-0" />
                <span className="text-red-600 truncate">휴지통</span>
              </>
            )}
            {!trashMode && breadcrumb.map((b) => (
              <span key={b.id} className="flex items-center gap-1 min-w-0">
                <ChevronRight size={16} className="text-text-tertiary flex-shrink-0" />
                <button
                  type="button"
                  onClick={() => setCurrentFolderId(b.id)}
                  className="hover:underline truncate"
                >
                  {b.name}
                </button>
              </span>
            ))}
          </div>
          <p className="text-caption text-text-tertiary mt-1">
            {trashMode
              ? "30일 후 자동 영구 삭제. 복구 또는 영구 삭제 가능."
              : "폴더와 파일을 선택해 정리하세요. 폴더 위로 드래그하거나 Ctrl+X / Ctrl+V 사용."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* 백업 ZIP / 복원 / Google 백업 */}
          <DriveBackupActions trashMode={trashMode} toast={toast} fetchAll={fetchAll} />
          {/* AI 정리 토글 */}
          {!trashMode && (
            <button
              type="button"
              onClick={() => {
                setShowAI(true);
                setShowGooglePanel(false); // 우측 패널 중복 회피
              }}
              className="px-3 py-2 text-[12px] rounded-md flex items-center gap-1.5 text-[#673ab7] border border-[#e8def8] hover:bg-[#f3e5f5]"
              title="AI에게 드라이브 정리 부탁"
            >
              <Sparkles size={13} /> AI 정리
            </button>
          )}
          {/* 활동 기록 모달 */}
          <button
            type="button"
            onClick={() => setShowActivity(true)}
            className="px-3 py-2 text-[12px] rounded-md flex items-center gap-1.5 text-text-secondary border border-border-default hover:bg-bg-secondary"
            title="드라이브 활동 기록 — 최근 변경 이력"
          >
            <Activity size={13} /> 활동
          </button>
          {/* 휴지통 토글 */}
          <button
            type="button"
            onClick={() => setTrashMode((v) => !v)}
            className={`px-3 py-2 text-[12px] rounded-md flex items-center gap-1.5 ${
              trashMode
                ? "bg-red-600 text-white"
                : "text-text-secondary border border-border-default hover:bg-bg-secondary"
            }`}
            title="휴지통"
          >
            <Trash2 size={13} /> 휴지통
          </button>
          {/* "+ 신규" 드롭다운 */}
          <NewItemMenu
            show={showNewMenu}
            setShow={setShowNewMenu}
            creating={creating}
            currentFolderId={currentFolderId}
            fetchAll={fetchAll}
            createNew={createNew}
            excludeTypes={mode === "student" ? ["word_decks", "boards"] : []}
          />
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

      {/* 만료 임박 배너 + Quota 게이지 */}
      <DriveQuotaGauge info={info} />

      {/* 검색 + 휴지통 비우기 */}
      <div className="flex items-center gap-2 mb-4">
        <DriveSearchBar value={search} onChange={setSearch} history={searchHistory} />
        {/* 검색 상태 — 본문 backend 검색 중 또는 결과 카운트 */}
        {driveSearch.active && (
          <div className="text-[12px] text-text-tertiary inline-flex items-center gap-1.5">
            {driveSearch.loading ? (
              <span>본문 검색 중...</span>
            ) : driveSearch.results ? (
              <span>
                <b className="text-accent">{driveSearch.results.total}</b>건 매칭
                {driveSearch.results.folders.length > 0 && (
                  <span className="ml-1 text-text-tertiary">
                    (폴더 {driveSearch.results.folders.length})
                  </span>
                )}
              </span>
            ) : null}
          </div>
        )}
        {trashMode && items.length > 0 && (
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
      ) : filtered.length === 0 && filteredFolders.length === 0 ? (
        <div className="bg-bg-primary border-2 border-dashed border-border-default rounded-lg py-16 text-center">
          <div className="text-body text-text-tertiary">
            {trashMode ? "휴지통이 비어있습니다" : "아직 만든 자료가 없습니다"}
          </div>
          {!trashMode && (
            <div className="text-caption text-text-tertiary mt-1">
              강좌 안에서 "+ 만들기" 메뉴로 생성 가능
            </div>
          )}
        </div>
      ) : viewMode === "list" ? (
        <DriveListView
          trashMode={trashMode}
          filtered={filtered}
          filteredFolders={filteredFolders}
          sortKey={sortKey}
          sortDir={sortDir}
          toggleSort={toggleSort}
          setCurrentFolderId={setCurrentFolderId}
          selection={selectionProps}
          rename={renameProps}
          dragDrop={dragDropProps}
          matchMap={driveSearch.matchMap}
        />
      ) : (
        <DriveGridView
          trashMode={trashMode}
          filtered={filtered}
          filteredFolders={filteredFolders}
          setCurrentFolderId={setCurrentFolderId}
          selection={selectionProps}
          rename={renameProps}
          dragDrop={dragDropProps}
        />
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
        trashTab={trashMode}
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
          trashTab={trashMode}
          newMenu={((mode === "student"
            ? ["docs", "sheets", "decks", "surveys", "hwps"]
            : ["docs", "sheets", "decks", "surveys", "hwps", "word_decks", "boards"]) as ItemType[]).map((t) => ({
            type: t,
            meta: { label: TYPE_META[t].label, icon: TYPE_META[t].icon, color: TYPE_META[t].color },
          }))}
          onOpen={(it) => router.push(hrefFor(it as DriveItem))}
          onOpenNewWindow={(it) => {
            // 에듀테크 도구는 embed 뷰가 없음 — 도구 페이지를 새 창으로
            if (it.type === "word_decks") {
              window.open(`/tools/wordbook/${it.id}`, "_blank");
              return;
            }
            if (it.type === "boards") {
              window.open(`/tools/board/${it.id}`, "_blank");
              return;
            }
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

      {/* 활동 기록 모달 */}
      {showActivity && <DriveActivityModal onClose={() => setShowActivity(false)} />}

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

      {/* Drive AI 사이드바 + 미리보기 모달 */}
      <AIAssistantPanel
        toolKind="drive"
        toolId={info ? 0 : 0}
        applyHandler={async (call) => {
          if (call.name === "drive_propose_organization") {
            const summary = String(call.arguments?.summary || "정리안");
            const actions = Array.isArray(call.arguments?.actions) ? call.arguments.actions : [];
            setProposal({ summary, actions });
          }
        }}
        getCurrentContent={() => buildDriveContext(
          aiSnapshotItems.length ? aiSnapshotItems : items,
          aiSnapshotFolders.length ? aiSnapshotFolders : folders,
        )}
        open={showAI}
        onClose={() => setShowAI(false)}
      />

      {proposal && (
        <DriveProposalModal
          summary={proposal.summary}
          actions={proposal.actions}
          itemsLookup={Object.fromEntries(
            (aiSnapshotItems.length ? aiSnapshotItems : items)
              .map((it) => [`${it.type}:${it.id}`, it.title])
          )}
          foldersLookup={Object.fromEntries(
            (aiSnapshotFolders.length ? aiSnapshotFolders : folders)
              .map((f) => [f.id, f.name])
          )}
          onClose={() => setProposal(null)}
          onApplied={() => {
            setProposal(null);
            fetchAll();
            toast.show("AI 정리 적용 완료", "success");
          }}
        />
      )}
    </div>
  );
}
