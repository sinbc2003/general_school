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
  Trash2, AlertTriangle, Search, X,
  Globe, PanelRightOpen, PanelRightClose, Plus, ChevronDown,
  LayoutGrid, List as ListIcon,
  Folder as FolderIcon, ChevronRight, ArrowUp, ArrowDown,
  Sparkles, Download, Upload,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { useToast } from "@/components/ui/Toast";
import { useAIAssistant } from "@/lib/ai-assistant-context";
import { AIAssistantPanel } from "@/components/tool-ai/AIAssistantPanel";
import type { ApplyHandler } from "@/components/tool-ai/types";
import { GoogleDriveSidePanel } from "./GoogleDriveSidePanel";
import { ShareFromDrive } from "./ShareFromDrive";
import { BulkActionBar } from "./BulkActionBar";
import { DriveContextMenu } from "./DriveContextMenu";
import { MoveToFolderModal } from "./MoveToFolderModal";
import { DriveProposalModal, type ProposalAction } from "./DriveProposalModal";
import type { FolderNode } from "./FolderSidebar";
import {
  TYPE_META, formatMB, hrefForItem,
  type ItemType, type SortKey, type SortDir,
  type DriveItem, type DriveInfo,
} from "./_drive-shared";
import { useDriveKeyboardShortcuts } from "./useDriveKeyboardShortcuts";
import { useDriveRubberBand } from "./useDriveRubberBand";
import { useDriveSearch } from "./useDriveSearch";
import { FolderRow } from "./FolderRow";
import { ItemRow } from "./ItemRow";
import { FolderCard } from "./FolderCard";
import { ItemCard } from "./ItemCard";

export function DrivePage({ mode }: { mode: "admin" | "student" }) {
  // 휴지통 모드 (탭 대신 단순 boolean)
  const [trashMode, setTrashMode] = useState(false);
  const [items, setItems] = useState<DriveItem[]>([]);
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [breadcrumb, setBreadcrumb] = useState<{ id: number; name: string }[]>([]);
  // 정렬
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  // 잘라내기/복사 (Ctrl+X/C) — itemKey set. Ctrl+V로 현재 폴더에 붙여넣기.
  // clipMode: 'cut' = 이동(move), 'copy' = 복제(copy)
  const [cutKeys, setCutKeys] = useState<Set<string>>(new Set());
  const [clipMode, setClipMode] = useState<"cut" | "copy">("cut");
  // 드래그&드롭 — 현재 hover 중인 폴더 ID (visual highlight)
  const [dragOverFolderId, setDragOverFolderId] = useState<number | null>(null);
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
  const toast = useToast();
  const ai = useAIAssistant();

  // Drive AI 패널
  const [showAI, setShowAI] = useState(false);
  const [proposal, setProposal] = useState<{ summary: string; actions: ProposalAction[] } | null>(null);
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

  // 이름 바꾸기 (F2 / 우클릭 메뉴) — 현재 편집 중인 키 + draft
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  // 폴더 — 현재 보기 폴더 (null = 루트, number = 그 폴더 안)
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
  const [moveTargets, setMoveTargets] = useState<DriveItem[] | null>(null);

  const itemKey = (it: DriveItem) => `${it.type}:${it.id}`;

  // 빈영역 드래그 박스 다중 선택 — useDriveRubberBand
  const { dragBox, startRubberBand } = useDriveRubberBand({ selected, setSelected });

  // backend 검색 — 본문/제목/폴더 통합 검색 (debounce 400ms, 2자 이상)
  const driveSearch = useDriveSearch(search, trashMode);

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


  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 휴지통: 자료만 (폴더 없음, breadcrumb 없음)
      if (trashMode) {
        const [i, list] = await Promise.all([
          api.get<DriveInfo>("/api/drive/me"),
          api.get<{ items: DriveItem[] }>(`/api/drive/items?trash=true&type=all`),
        ]);
        setInfo(i);
        setItems(list.items);
        setFolders([]);
        setBreadcrumb([]);
        return;
      }
      // 일반: 현재 폴더의 직속 폴더 + 직속 자료 + breadcrumb
      const itemsQS =
        currentFolderId === null ? "&no_folder=true" : `&folder_id=${currentFolderId}`;
      const folderParent = currentFolderId === null ? 0 : currentFolderId; // 0 → IS NULL
      const promises: Promise<any>[] = [
        api.get<DriveInfo>("/api/drive/me"),
        api.get<{ items: DriveItem[] }>(
          `/api/drive/items?trash=false&type=all${itemsQS}`
        ),
        api.get<{ items: FolderNode[] }>(`/api/drive/folders?parent_id=${folderParent}`),
      ];
      if (currentFolderId !== null) {
        promises.push(
          api.get<{ breadcrumb: { id: number; name: string }[] }>(
            `/api/drive/folders/${currentFolderId}`
          )
        );
      }
      const [i, list, foldersR, detail] = await Promise.all(promises);
      setInfo(i);
      setItems(list.items);
      setFolders(foldersR.items);
      setBreadcrumb(detail?.breadcrumb || []);
    } catch (e: any) {
      setError(e?.message || "불러오기 실패");
    } finally {
      setLoading(false);
    }
  }, [trashMode, currentFolderId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

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
        if (it && !trashMode) {
          e.preventDefault();
          startRename(it);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, items, trashMode, renamingKey]);

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
          {/* 백업 다운로드 — 학교 이동 시 */}
          {!trashMode && (
            <button
              type="button"
              onClick={async () => {
                try {
                  const API_URL = process.env.NEXT_PUBLIC_API_URL || "";
                  const tokenKey = localStorage.getItem("access_token");
                  toast.show("백업 만드는 중... (자료 많으면 수십 초)", "info");
                  const res = await fetch(`${API_URL}/api/drive/backup/download`, {
                    method: "POST",
                    headers: tokenKey ? { Authorization: `Bearer ${tokenKey}` } : {},
                  });
                  if (!res.ok) throw new Error(`HTTP ${res.status}`);
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");
                  a.download = `drive-backup-${today}.zip`;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  URL.revokeObjectURL(url);
                  toast.show("백업 다운로드 완료", "success");
                } catch (e: any) {
                  alert(e?.message || "백업 실패");
                }
              }}
              className="px-3 py-2 text-[12px] rounded-md flex items-center gap-1.5 text-text-secondary border border-border-default hover:bg-bg-secondary"
              title="내 드라이브 전체 ZIP 다운로드 (학교 이동 시)"
            >
              <Download size={13} /> 백업 ZIP
            </button>
          )}
          {/* 복원 (ZIP 업로드) */}
          {!trashMode && (
            <>
              <input
                type="file"
                accept=".zip,application/zip"
                style={{ display: "none" }}
                id="drive-restore-input"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  e.target.value = ""; // reset
                  if (!confirm(
                    `"${f.name}" 백업을 내 드라이브에 복원합니다.\n` +
                    `기존 자료는 그대로 유지됩니다 (새 자료로 추가).\n` +
                    `진행하시겠습니까?`
                  )) return;
                  try {
                    toast.show("복원 중... (자료 많으면 수십 초)", "info");
                    const r = await api.upload<{
                      imported: { folders: number; docs: number; sheets: number; decks: number; surveys: number; hwps: number };
                      consumed_bytes: number;
                      note: string;
                    }>("/api/drive/backup/import", f);
                    const i = r.imported;
                    alert(
                      `복원 완료\n\n` +
                      `폴더: ${i.folders}\n` +
                      `문서: ${i.docs}\n` +
                      `시트: ${i.sheets}\n` +
                      `프리젠테이션: ${i.decks}\n` +
                      `설문지: ${i.surveys}\n` +
                      `HWP: ${i.hwps}\n\n` +
                      `${r.note}`
                    );
                    fetchAll();
                  } catch (err: any) {
                    alert(err?.detail || err?.message || "복원 실패");
                  }
                }}
              />
              <button
                type="button"
                onClick={() => document.getElementById("drive-restore-input")?.click()}
                className="px-3 py-2 text-[12px] rounded-md flex items-center gap-1.5 text-text-secondary border border-border-default hover:bg-bg-secondary"
                title="다른 학교에서 가져온 백업 ZIP을 복원"
              >
                <Upload size={13} /> 복원
              </button>
            </>
          )}
          {/* Google Drive 일괄 export */}
          {!trashMode && (
            <button
              type="button"
              onClick={async () => {
                if (!confirm("본인 문서·스프레드시트를 Google Drive로 일괄 업로드합니다.\n(프리젠테이션·설문지·한컴은 미지원 — ZIP 백업 권장)\n진행하시겠습니까?")) return;
                try {
                  toast.show("Google Drive로 업로드 중... (자료 많으면 시간 걸림)", "info");
                  const r = await api.post<{ ok: number; failed: number; total: number }>(
                    "/api/google/export/my-drive-bulk", {},
                  );
                  toast.show(
                    `Google Drive 백업 완료 — ${r.ok}/${r.total} 성공${r.failed ? `, ${r.failed} 실패` : ""}`,
                    r.failed > 0 ? "error" : "success",
                  );
                } catch (e: any) {
                  const msg = e?.detail || e?.message || "";
                  if (msg.includes("토큰") || msg.includes("Google") || e?.status === 400) {
                    alert(
                      "Google 계정이 연결되지 않았습니다.\n" +
                      "/system/integrations/google 페이지에서 먼저 Google 계정을 연결하세요.\n\n" +
                      `(${msg || "연결 필요"})`
                    );
                  } else {
                    alert(msg || "Google Drive 백업 실패");
                  }
                }
              }}
              className="px-3 py-2 text-[12px] rounded-md flex items-center gap-1.5 text-text-secondary border border-border-default hover:bg-bg-secondary"
              title="문서·시트를 본인 Google Drive로 일괄 업로드"
            >
              <Globe size={13} /> Google 백업
            </button>
          )}
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
                <button
                  type="button"
                  onClick={async () => {
                    setShowNewMenu(false);
                    const raw = prompt("새 폴더 이름");
                    if (!raw?.trim()) return;
                    try {
                      await api.post("/api/drive/folders", {
                        name: raw.trim(),
                        parent_id: currentFolderId,
                      });
                      await fetchAll();
                    } catch (e: any) {
                      alert(e?.detail || e?.message || "폴더 생성 실패");
                    }
                  }}
                  className="w-full text-left px-3 py-2 text-[13px] hover:bg-bg-secondary flex items-center gap-2 text-text-primary"
                >
                  <FolderIcon size={14} className="text-amber-500" /> 새 폴더
                </button>
                <div className="my-1 border-t border-border-default/50" />
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

      {/* 검색 + 휴지통 비우기 */}
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            type="text"
            placeholder="제목·본문·폴더 검색 (2자 이상)..."
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
        /* 자세히(리스트) 뷰 — 구글 드라이브 식. overflow-visible로 ⋮ 메뉴 잘림 방지 */
        <div className="bg-bg-primary border border-border-default rounded-lg">
          <table className="w-full text-[13px]">
            <thead className="bg-bg-secondary border-b border-border-default text-text-tertiary sticky top-0 z-10">
              <tr>
                <th className="px-4 py-2 text-left font-medium w-10"></th>
                <SortableTh sortKey="name" currentKey={sortKey} dir={sortDir} onClick={toggleSort}>
                  이름
                </SortableTh>
                <th className="px-2 py-2 text-left font-medium w-32">유형</th>
                <SortableTh
                  sortKey="updated"
                  currentKey={sortKey}
                  dir={sortDir}
                  onClick={toggleSort}
                  className="w-40"
                >
                  {trashMode ? "삭제일" : "수정일"}
                </SortableTh>
                <SortableTh
                  sortKey="size"
                  currentKey={sortKey}
                  dir={sortDir}
                  onClick={toggleSort}
                  align="right"
                  className="w-24"
                >
                  크기
                </SortableTh>
                <th className="px-2 py-2 w-12"></th>
              </tr>
            </thead>
            <tbody>
              {/* 폴더 행 — 휴지통 아닐 때만 */}
              {!trashMode && filteredFolders.map((f) => (
                <FolderRow
                  key={`folder:${f.id}`}
                  folder={f}
                  isSelected={selected.has(`folder:${f.id}`)}
                  isDragOver={dragOverFolderId === f.id}
                  onClickSelect={(key, additive) => {
                    if (additive) {
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      });
                    } else {
                      setSelected(new Set([key]));
                    }
                  }}
                  onEnter={(fid) => { setCurrentFolderId(fid); setSelected(new Set()); }}
                  onDragOverFolder={(fid) => setDragOverFolderId(fid)}
                  onDragLeaveFolder={(fid) => { if (dragOverFolderId === fid) setDragOverFolderId(null); }}
                  onDrop={async (fid, list) => {
                    setDragOverFolderId(null);
                    try {
                      for (const t of list) {
                        await api.post(`/api/drive/items/${t.type}/${t.id}/move`, { folder_id: fid });
                      }
                      setSelected(new Set());
                      fetchAll();
                    } catch (err: any) {
                      alert(err?.detail || err?.message || "이동 실패");
                    }
                  }}
                />
              ))}
              {filtered.map((it) => {
                const menuKey = `${it.type}:${it.id}`;
                return (
                  <ItemRow
                    key={menuKey}
                    item={it}
                    trashMode={trashMode}
                    isSelected={selected.has(menuKey)}
                    isCut={cutKeys.has(menuKey)}
                    isMenuOpen={menuOpen === menuKey}
                    renaming={renamingKey === menuKey}
                    renameDraft={renameDraft}
                    setRenameDraft={setRenameDraft}
                    commitRename={commitRename}
                    cancelRename={() => setRenamingKey(null)}
                    onClick={(e) => handleItemClick(it, e)}
                    onDoubleClick={(e) => handleItemDoubleClick(it, e)}
                    onContextMenu={(e) => handleItemContextMenu(it, e)}
                    onMenuToggle={() => setMenuOpen(menuOpen === menuKey ? null : menuKey)}
                    onMenuClose={() => setMenuOpen(null)}
                    onSoftDelete={doSoftDelete}
                    onRestore={doRestore}
                    onPermanent={doPermanent}
                    getDragPayload={() =>
                      selected.has(menuKey)
                        ? items.filter((x) => selected.has(itemKey(x))).map((x) => ({ type: x.type, id: x.id }))
                        : [{ type: it.type, id: it.id }]
                    }
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {/* 폴더 카드 — 휴지통이 아닐 때만 */}
          {!trashMode && filteredFolders.map((f) => (
            <FolderCard
              key={`folder:${f.id}`}
              folder={f}
              isSelected={selected.has(`folder:${f.id}`)}
              isDragOver={dragOverFolderId === f.id}
              onClickSelect={(key, additive) => {
                if (additive) {
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  });
                } else {
                  setSelected(new Set([key]));
                }
              }}
              onEnter={(fid) => { setCurrentFolderId(fid); setSelected(new Set()); }}
              onDragOverFolder={(fid) => setDragOverFolderId(fid)}
              onDragLeaveFolder={(fid) => { if (dragOverFolderId === fid) setDragOverFolderId(null); }}
              onDrop={async (fid, list) => {
                setDragOverFolderId(null);
                try {
                  for (const t of list) {
                    await api.post(`/api/drive/items/${t.type}/${t.id}/move`, { folder_id: fid });
                  }
                  setSelected(new Set());
                  fetchAll();
                } catch (err: any) {
                  alert(err?.detail || err?.message || "이동 실패");
                }
              }}
            />
          ))}
          {filtered.map((it) => {
            const menuKey = `${it.type}:${it.id}`;
            return (
              <ItemCard
                key={menuKey}
                item={it}
                trashMode={trashMode}
                isSelected={selected.has(menuKey)}
                isCut={cutKeys.has(menuKey)}
                isMenuOpen={menuOpen === menuKey}
                renaming={renamingKey === menuKey}
                renameDraft={renameDraft}
                setRenameDraft={setRenameDraft}
                commitRename={commitRename}
                cancelRename={() => setRenamingKey(null)}
                onClick={(e) => handleItemClick(it, e)}
                onDoubleClick={(e) => handleItemDoubleClick(it, e)}
                onContextMenu={(e) => handleItemContextMenu(it, e)}
                onMenuToggle={() => setMenuOpen(menuOpen === menuKey ? null : menuKey)}
                onMenuClose={() => setMenuOpen(null)}
                onSoftDelete={doSoftDelete}
                onRestore={doRestore}
                onPermanent={doPermanent}
                getDragPayload={() =>
                  selected.has(menuKey)
                    ? items.filter((x) => selected.has(itemKey(x))).map((x) => ({ type: x.type, id: x.id }))
                    : [{ type: it.type, id: it.id }]
                }
              />
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


/**
 * Drive AI에 보낼 현재 드라이브 상태 (메타만 — 본문 X).
 * 자료는 type/id/제목/현재 folder_id. 폴더는 id/이름/parent/잠금 여부.
 * 토큰 절약 위해 간결한 line 포맷.
 */
function buildDriveContext(items: DriveItem[], folders: FolderNode[]): string {
  const folderLines = folders.map(
    (f) =>
      `F${f.id} parent=${f.parent_id ?? "root"} name="${f.name}"${f.is_system_locked ? " [LOCKED]" : ""}`,
  );
  const itemLines = items.map(
    (it) =>
      `${it.type}:${it.id} folder=${it.folder_id ?? "root"} title="${it.title}"`,
  );
  return [
    "# 현재 드라이브 상태",
    "",
    `## 폴더 (${folders.length})`,
    ...folderLines,
    "",
    `## 자료 (${items.length})`,
    ...itemLines,
    "",
    "위 자료를 분석해 drive_propose_organization 도구로 정리안을 한 번 호출하세요.",
    "삭제 금지. rename은 '01. 원본이름' 식 prefix. 새 카테고리 폴더는 create_folder.",
    "잠금 폴더(LOCKED)는 그 자체 수정/삭제 금지. 그 안에 자료 이동은 OK.",
  ].join("\n");
}


// ── 정렬 가능 컬럼 헤더 ───────────────────────────────────────────────

function SortableTh({
  sortKey,
  currentKey,
  dir,
  onClick,
  align,
  className,
  children,
}: {
  sortKey: SortKey;
  currentKey: SortKey;
  dir: SortDir;
  onClick: (k: SortKey) => void;
  align?: "left" | "right";
  className?: string;
  children: React.ReactNode;
}) {
  const isActive = sortKey === currentKey;
  return (
    <th className={`px-2 py-2 font-medium ${className || ""} ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-text-primary ${
          isActive ? "text-text-primary" : ""
        }`}
      >
        {children}
        {isActive && (dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </button>
    </th>
  );
}
