"use client";

/**
 * 보드 (Padlet형) — 실시간 협업 담벼락. 교사/학생 공유 컴포넌트.
 *
 * Yjs 문서 구조 (Hocuspocus `board-{id}`):
 *  - Y.Map("cards")    cardId → 카드 객체 (카드 단위 LWW)
 *  - Y.Map("board")    "sections" → [{id,name}] (섹션은 moderator만 편집 — LWW OK)
 *  - Y.Map("likes")    `${cardId}:${userId}` → {user_id,name}  (본인 키만 set/delete — 충돌 없음)
 *  - Y.Map("comments") commentId → {id,card_id,text,author_id,author_name,created}
 *
 * Padlet 동일 기능:
 *  - 섹션: 인라인 추가/이름 수정/삭제(카드는 첫 섹션으로)/좌우 이동 — 실시간 동기
 *  - 카드: 제목(선택)+본문, 색상, 이미지 업로드, 링크 첨부, 드래그&드롭 이동(pos)
 *  - 좋아요(하트), 카드 댓글 스레드
 *  - 정렬: 최신순/좋아요순/수동(드래그)
 *  - 승인 후 게시(requires_approval), 작성자 익명 표시(hide_authors), CSV 내보내기
 *
 * 레거시 호환: 구 카드의 column(index)은 섹션 id `col-{i}`로 매핑.
 * 섹션이 Yjs에 없으면 meta.columns로 가상 섹션 렌더 + 쓰기 가능자가 1회 seed.
 */

import {
  useCallback, useEffect, useMemo, useRef, useState, type ReactNode,
} from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import {
  Loader2, Plus, Trash2, Pencil, Check, X, Wifi, WifiOff, Eye, Heart,
  MessageCircle, ImagePlus, Link as LinkIcon, ChevronLeft, ChevronRight,
  Download, ArrowDownWideNarrow, ShieldCheck, ExternalLink as ExtIcon,
  Search, Play,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { useAuth } from "@/lib/auth-context";
import { getHocuspocusUrl } from "@/lib/collab/hocuspocus-url";

// ── 배경 테마 (Padlet 월페이퍼 식) — 설정 모달과 공유 ──
export const BOARD_BACKGROUNDS: { key: string; label: string; css: string; dark?: boolean }[] = [
  { key: "cream", label: "크림", css: "linear-gradient(160deg,#fdfbf7 0%,#f3ead8 100%)" },
  { key: "sunset", label: "노을", css: "linear-gradient(160deg,#fff1be 0%,#ffb199 55%,#ff8e9e 100%)" },
  { key: "ocean", label: "바다", css: "linear-gradient(160deg,#c9f0ff 0%,#7fd4f5 55%,#5aa9e6 100%)" },
  { key: "forest", label: "숲", css: "linear-gradient(160deg,#e7f8d8 0%,#a8e0a2 60%,#6fbf8b 100%)" },
  { key: "lavender", label: "라벤더", css: "linear-gradient(160deg,#f3e8ff 0%,#d8b4fe 60%,#a78bfa 100%)" },
  { key: "candy", label: "캔디", css: "linear-gradient(160deg,#ffe4ef 0%,#fbc2eb 50%,#a6c1ee 100%)" },
  { key: "night", label: "밤하늘", css: "linear-gradient(160deg,#1e293b 0%,#312e81 60%,#0f172a 100%)", dark: true },
  { key: "blackboard", label: "칠판", css: "linear-gradient(160deg,#27403a 0%,#1d2e2a 100%)", dark: true },
];

export function backgroundOf(key: string | undefined) {
  return BOARD_BACKGROUNDS.find((b) => b.key === key) || BOARD_BACKGROUNDS[0];
}

const CARD_COLORS = ["#ffffff", "#fef9c3", "#dbeafe", "#fce7f3", "#dcfce7", "#ede9fe", "#ffedd5"];

interface BoardMeta {
  id: number;
  title: string;
  description?: string | null;
  columns: string[];
  background?: string;
  is_archived: boolean;
  owner_name?: string | null;
  requires_approval?: boolean;
  hide_authors?: boolean;
  new_card_position?: "top" | "bottom";
  default_sort?: "manual" | "newest" | "likes";
  layout?: "shelf" | "canvas" | "wall";
  permission: { can_read: boolean; can_write: boolean; role: string | null };
}

export interface BoardSection { id: string; name: string }

export interface BoardCard {
  id: string;
  title?: string;
  text: string;
  color: string;
  section_id?: string;
  column?: number; // 레거시 (v1 카드) — col-{i} 매핑
  author_id: number;
  author_name: string;
  created: number;
  pos?: number;          // 수동 정렬 (fractional indexing)
  image_url?: string;    // /storage/boards/{bid}/...
  link_url?: string;
  approved?: boolean;    // undefined = 승인됨 (레거시)
  cx?: number;           // 자유배치(canvas) 좌표 px
  cy?: number;
}

interface BoardComment {
  id: string;
  card_id: string;
  text: string;
  author_id: number;
  author_name: string;
  created: number;
}

interface LikeEntry { user_id: number; name: string }

type SortMode = "manual" | "newest" | "likes";

function relTime(ms: number): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "방금";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  return new Date(ms).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}

const AVATAR_COLORS = ["#f97316", "#0ea5e9", "#8b5cf6", "#10b981", "#ef4444", "#eab308", "#ec4899"];
function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 9973;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function posOf(c: BoardCard): number {
  return typeof c.pos === "number" ? c.pos : (c.created || 0);
}

function newId(prefix: string, userId?: number): string {
  return `${prefix}-${userId ?? 0}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

// ── 인증 이미지 (storage는 Bearer 필요 → blob) — 모듈 레벨 캐시 ──
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8002";
const imgCache = new Map<string, string>();

function AuthedImg({ url, className, onClick }: { url: string; className?: string; onClick?: () => void }) {
  const [src, setSrc] = useState<string | null>(imgCache.get(url) || null);
  useEffect(() => {
    if (imgCache.has(url)) { setSrc(imgCache.get(url)!); return; }
    let cancelled = false;
    (async () => {
      try {
        const token = localStorage.getItem("access_token");
        const r = await fetch(
          `${API_URL}${url.replace(/^\/storage\//, "/api/files/storage/")}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} },
        );
        if (!r.ok) return;
        const obj = URL.createObjectURL(await r.blob());
        imgCache.set(url, obj);
        if (!cancelled) setSrc(obj);
      } catch { /* 이미지 실패는 무시 */ }
    })();
    return () => { cancelled = true; };
  }, [url]);
  if (!src) return <div className={`${className} bg-black/5 animate-pulse rounded-lg min-h-[80px]`} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className={className} onClick={onClick} />;
}

// ── OG 링크 미리보기 (embeds/og-preview 재사용 — SSRF 방어는 backend) ──
interface OgData { title?: string; description?: string; image?: string }
const ogCache = new Map<string, OgData | null>();

function LinkPreview({ url }: { url: string }) {
  const [og, setOg] = useState<OgData | null | undefined>(
    ogCache.has(url) ? ogCache.get(url) : undefined,
  );
  useEffect(() => {
    if (ogCache.has(url)) { setOg(ogCache.get(url)); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<OgData>(`/api/embeds/og-preview?url=${encodeURIComponent(url)}`);
        const data = res && (res.title || res.image || res.description) ? res : null;
        ogCache.set(url, data);
        if (!cancelled) setOg(data);
      } catch {
        ogCache.set(url, null);
        if (!cancelled) setOg(null);
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  const host = url.replace(/^https?:\/\//, "").split("/")[0];

  if (og) {
    return (
      <a
        href={url} target="_blank" rel="noopener noreferrer"
        className="block mt-1.5 rounded-lg overflow-hidden border border-black/10 bg-white/80 hover:bg-white transition"
      >
        {og.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={og.image} alt="" className="w-full max-h-28 object-cover" />
        )}
        <div className="px-2 py-1.5">
          <div className="text-[11.5px] font-semibold text-gray-800 line-clamp-1">
            {og.title || host}
          </div>
          {og.description && (
            <div className="text-[10.5px] text-gray-500 line-clamp-2">{og.description}</div>
          )}
          <div className="text-[10px] text-sky-600 truncate">{host}</div>
        </div>
      </a>
    );
  }
  // 미리보기 실패/로딩 — 기존 칩
  return (
    <a
      href={url} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-1 mt-1.5 text-[11.5px] text-sky-700 bg-sky-50/80 rounded-lg px-2 py-1 hover:bg-sky-100 truncate"
    >
      <ExtIcon size={11} className="flex-shrink-0" />
      <span className="truncate">{url.replace(/^https?:\/\//, "")}</span>
    </a>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function BoardView({
  boardId, headerActions,
}: {
  boardId: number;
  headerActions?: ReactNode;
}) {
  const { user } = useAuth();
  const [meta, setMeta] = useState<BoardMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<BoardCard[]>([]);
  const [ySections, setYSections] = useState<BoardSection[] | null>(null);
  const [likes, setLikes] = useState<Map<string, LikeEntry[]>>(new Map());
  const [comments, setComments] = useState<Map<string, BoardComment[]>>(new Map());
  const [connected, setConnected] = useState(false);
  const [synced, setSynced] = useState(false);
  const [activeCount, setActiveCount] = useState(0);
  const [sortMode, setSortMode] = useState<SortMode | null>(null); // null → meta default
  const [dragCardId, setDragCardId] = useState<string | null>(null);
  const [query, setQuery] = useState("");                 // 검색 (Padlet 툴바)
  const [searchOpen, setSearchOpen] = useState(false);
  const [slideshow, setSlideshow] = useState(false);      // 슬라이드쇼
  const [wallComposing, setWallComposing] = useState(false); // + 게시 (wall)

  const yCardsRef = useRef<Y.Map<any> | null>(null);
  const yBoardRef = useRef<Y.Map<any> | null>(null);
  const yLikesRef = useRef<Y.Map<any> | null>(null);
  const yCommentsRef = useRef<Y.Map<any> | null>(null);

  // ── 메타 로드 ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<BoardMeta>(`/api/classroom/boards/${boardId}`);
        if (!cancelled) setMeta(res);
      } catch (e: any) {
        if (!cancelled) setError(e?.detail || "보드에 접근할 수 없습니다");
      }
    })();
    return () => { cancelled = true; };
  }, [boardId]);

  // ── Yjs + Hocuspocus ─────────────────────────────────────────────────
  useEffect(() => {
    if (!meta) return;
    const yDoc = new Y.Doc();
    const yCards = yDoc.getMap<any>("cards");
    const yBoard = yDoc.getMap<any>("board");
    const yLikes = yDoc.getMap<any>("likes");
    const yComments = yDoc.getMap<any>("comments");
    yCardsRef.current = yCards;
    yBoardRef.current = yBoard;
    yLikesRef.current = yLikes;
    yCommentsRef.current = yComments;

    const readCards = () => {
      const out: BoardCard[] = [];
      yCards.forEach((v) => {
        if (v && typeof v === "object" && v.id) out.push(v as BoardCard);
      });
      setCards(out);
    };
    const readSections = () => {
      const s = yBoard.get("sections");
      setYSections(Array.isArray(s) && s.length > 0 ? (s as BoardSection[]) : null);
    };
    const readLikes = () => {
      const m = new Map<string, LikeEntry[]>();
      yLikes.forEach((v, k) => {
        const cardId = String(k).split(":")[0];
        if (!cardId) return;
        const arr = m.get(cardId) || [];
        if (v && typeof v === "object") arr.push(v as LikeEntry);
        m.set(cardId, arr);
      });
      setLikes(m);
    };
    const readComments = () => {
      const m = new Map<string, BoardComment[]>();
      yComments.forEach((v) => {
        if (!v || typeof v !== "object" || !v.card_id) return;
        const arr = m.get(v.card_id) || [];
        arr.push(v as BoardComment);
        m.set(v.card_id, arr);
      });
      m.forEach((arr) => arr.sort((a, b) => (a.created || 0) - (b.created || 0)));
      setComments(m);
    };

    const prov = new HocuspocusProvider({
      url: getHocuspocusUrl(),
      name: `board-${boardId}`,
      document: yDoc,
      async token() {
        await api.ensureFreshToken().catch(() => false);
        return localStorage.getItem("access_token") ?? "";
      },
      onStatus: ({ status }) => setConnected(status === "connected"),
      onAuthenticationFailed: ({ reason }) => setError(reason || "협업 서버 인증 실패"),
      onSynced: () => {
        // 섹션 1회 마이그레이션: Yjs에 없으면 meta.columns 기반으로 seed
        // (id `col-{i}` — 레거시 카드의 column index 매핑과 일치)
        const existing = yBoard.get("sections");
        if ((!Array.isArray(existing) || existing.length === 0) && meta.permission.can_write) {
          const cols = meta.columns.length > 0 ? meta.columns : ["보드"];
          yBoard.set("sections", cols.map((name, i) => ({ id: `col-${i}`, name })));
        }
        readCards(); readSections(); readLikes(); readComments();
        setSynced(true);
      },
    });

    try {
      prov.setAwarenessField("user", { name: user?.name || "익명" });
    } catch { /* noop */ }
    const aw = (prov as any).awareness;
    const onAw = () => {
      try { setActiveCount(aw?.getStates()?.size ?? 0); } catch { /* noop */ }
    };
    try { aw?.on("change", onAw); onAw(); } catch { /* noop */ }

    yCards.observe(readCards);
    yBoard.observe(readSections);
    yLikes.observe(readLikes);
    yComments.observe(readComments);

    return () => {
      yCards.unobserve(readCards);
      yBoard.unobserve(readSections);
      yLikes.unobserve(readLikes);
      yComments.unobserve(readComments);
      try { aw?.off("change", onAw); } catch { /* noop */ }
      try { prov.destroy(); } catch { /* noop */ }
      try { yDoc.destroy(); } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, meta?.id]);

  // 14분마다 access_token 백그라운드 갱신
  useEffect(() => {
    const id = setInterval(() => {
      api.ensureFreshToken().catch(() => undefined);
    }, 14 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // ── 파생 상태 ────────────────────────────────────────────────────────
  const canWrite = !!meta?.permission?.can_write && synced;
  const role = meta?.permission?.role;
  const isModerator = role === "owner" || role === "admin";
  const requiresApproval = !!meta?.requires_approval;
  const hideAuthors = !!meta?.hide_authors;
  const effectiveSort: SortMode = sortMode ?? (meta?.default_sort as SortMode) ?? "newest";

  // 섹션: Yjs 우선, 없으면 meta.columns 가상 섹션 (viewer-only 보드)
  const sections: BoardSection[] = useMemo(() => {
    if (ySections && ySections.length > 0) return ySections;
    const cols = meta?.columns?.length ? meta.columns : ["보드"];
    return cols.map((name, i) => ({ id: `col-${i}`, name }));
  }, [ySections, meta?.columns]);

  const sectionIdOf = useCallback((c: BoardCard): string => {
    const sid = c.section_id ?? `col-${c.column ?? 0}`;
    return sections.some((s) => s.id === sid) ? sid : (sections[0]?.id ?? "col-0");
  }, [sections]);

  const likeCount = useCallback((cardId: string) => (likes.get(cardId) || []).length, [likes]);
  const iLiked = useCallback(
    (cardId: string) => !!user && (likes.get(cardId) || []).some((l) => l.user_id === user.id),
    [likes, user],
  );

  // 승인 + 검색 필터 적용된 평탄 목록
  const visibleCards = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cards.filter((c) => {
      if (c.approved === false && !isModerator && c.author_id !== user?.id) return false;
      if (!q) return true;
      return (
        (c.text || "").toLowerCase().includes(q)
        || (c.title || "").toLowerCase().includes(q)
        || (c.author_name || "").toLowerCase().includes(q)
      );
    });
  }, [cards, isModerator, user?.id, query]);

  const cardsBySection = useMemo(() => {
    const out = new Map<string, BoardCard[]>();
    sections.forEach((s) => out.set(s.id, []));
    for (const c of visibleCards) {  // 승인+검색 필터 적용분
      out.get(sectionIdOf(c))?.push(c);
    }
    const cmp = (a: BoardCard, b: BoardCard) => {
      if (effectiveSort === "likes") {
        const d = likeCount(b.id) - likeCount(a.id);
        if (d !== 0) return d;
        return (b.created || 0) - (a.created || 0);
      }
      if (effectiveSort === "manual") return posOf(a) - posOf(b);
      return (b.created || 0) - (a.created || 0); // newest
    };
    out.forEach((arr) => arr.sort(cmp));
    return out;
  }, [visibleCards, sections, sectionIdOf, effectiveSort, likeCount]);

  // wall(담벼락) masonry용 — 전체 카드 정렬 1열
  const sortedFlat = useMemo(() => {
    const arr = [...visibleCards];
    arr.sort((a, b) => {
      if (effectiveSort === "likes") {
        const d = likeCount(b.id) - likeCount(a.id);
        if (d !== 0) return d;
      }
      if (effectiveSort === "manual") return posOf(a) - posOf(b);
      return (b.created || 0) - (a.created || 0);
    });
    return arr;
  }, [visibleCards, effectiveSort, likeCount]);

  // ── 카드 조작 ─────────────────────────────────────────────────────────
  const addCard = useCallback((sectionId: string, payload: {
    title?: string; text: string; color: string; image_url?: string; link_url?: string;
    cx?: number; cy?: number;
  }) => {
    const yCards = yCardsRef.current;
    if (!yCards || !user || (!payload.text.trim() && !payload.image_url)) return;
    const inSection = cards.filter((c) => sectionIdOf(c) === sectionId);
    const positions = inSection.map(posOf);
    const newPos = (meta?.new_card_position === "bottom")
      ? (positions.length ? Math.max(...positions) + 1000 : Date.now())
      : (positions.length ? Math.min(...positions) - 1000 : Date.now());
    const id = newId("c", user.id);
    const card: BoardCard = {
      id,
      title: payload.title?.trim().slice(0, 150) || undefined,
      text: payload.text.trim().slice(0, 2000),
      color: payload.color,
      section_id: sectionId,
      author_id: user.id,
      author_name: user.name || `#${user.id}`,
      created: Date.now(),
      pos: newPos,
      image_url: payload.image_url,
      link_url: payload.link_url,
      approved: requiresApproval && !isModerator ? false : true,
      cx: payload.cx,
      cy: payload.cy,
    };
    yCards.set(id, card);
  }, [user, cards, sectionIdOf, meta?.new_card_position, requiresApproval, isModerator]);

  const updateCard = useCallback((card: BoardCard, patch: Partial<BoardCard>) => {
    yCardsRef.current?.set(card.id, { ...card, ...patch });
  }, []);

  const deleteCard = useCallback((card: BoardCard) => {
    yCardsRef.current?.delete(card.id);
    // 카드의 좋아요·댓글 정리
    const yLikes = yLikesRef.current;
    const yComments = yCommentsRef.current;
    if (yLikes) {
      const keys: string[] = [];
      yLikes.forEach((_v, k) => { if (String(k).startsWith(`${card.id}:`)) keys.push(String(k)); });
      keys.forEach((k) => yLikes.delete(k));
    }
    if (yComments) {
      const keys: string[] = [];
      yComments.forEach((v, k) => { if (v?.card_id === card.id) keys.push(String(k)); });
      keys.forEach((k) => yComments.delete(k));
    }
  }, []);

  const toggleLike = useCallback((card: BoardCard) => {
    const yLikes = yLikesRef.current;
    if (!yLikes || !user || !canWrite) return;
    const key = `${card.id}:${user.id}`;
    if (yLikes.has(key)) yLikes.delete(key);
    else yLikes.set(key, { user_id: user.id, name: user.name || "" });
  }, [user, canWrite]);

  const addComment = useCallback((card: BoardCard, text: string) => {
    const yComments = yCommentsRef.current;
    if (!yComments || !user || !text.trim()) return;
    const id = newId("cm", user.id);
    yComments.set(id, {
      id, card_id: card.id, text: text.trim().slice(0, 500),
      author_id: user.id, author_name: user.name || `#${user.id}`, created: Date.now(),
    });
    // 카드 작성자에게 알림 (best-effort — 본인 카드면 backend가 자동 skip)
    if (card.author_id !== user.id) {
      api.post(`/api/classroom/boards/${boardId}/notify-comment`, {
        recipient_id: card.author_id,
        excerpt: text.trim().slice(0, 100),
      }).catch(() => undefined);
    }
  }, [user, boardId]);

  const deleteComment = useCallback((c: BoardComment) => {
    yCommentsRef.current?.delete(c.id);
  }, []);

  // ── 섹션 조작 (moderator) ─────────────────────────────────────────────
  const writeSections = useCallback((next: BoardSection[]) => {
    yBoardRef.current?.set("sections", next);
  }, []);

  const addSection = useCallback(() => {
    const next = [...sections, { id: newId("s", user?.id), name: "새 섹션" }];
    writeSections(next);
  }, [sections, writeSections, user?.id]);

  const renameSection = useCallback((id: string, name: string) => {
    if (!name.trim()) return;
    writeSections(sections.map((s) => (s.id === id ? { ...s, name: name.trim().slice(0, 50) } : s)));
  }, [sections, writeSections]);

  const deleteSection = useCallback((id: string) => {
    if (sections.length <= 1) { alert("섹션은 1개 이상 필요합니다"); return; }
    const remaining = sections.filter((s) => s.id !== id);
    if (!confirm("섹션을 삭제할까요? 카드는 첫 섹션으로 이동합니다.")) return;
    const firstId = remaining[0].id;
    const yCards = yCardsRef.current;
    if (yCards) {
      cards.forEach((c) => {
        if (sectionIdOf(c) === id) yCards.set(c.id, { ...c, section_id: firstId });
      });
    }
    writeSections(remaining);
  }, [sections, cards, sectionIdOf, writeSections]);

  const moveSection = useCallback((id: string, dir: -1 | 1) => {
    const i = sections.findIndex((s) => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= sections.length) return;
    const next = [...sections];
    [next[i], next[j]] = [next[j], next[i]];
    writeSections(next);
  }, [sections, writeSections]);

  // ── 드래그&드롭 (수동 정렬로 전환) ────────────────────────────────────
  const handleDrop = useCallback((sectionId: string, beforeCard: BoardCard | null) => {
    if (!dragCardId) return;
    const card = cards.find((c) => c.id === dragCardId);
    setDragCardId(null);
    if (!card) return;
    const list = (cardsBySection.get(sectionId) || []).filter((c) => c.id !== card.id);
    let pos: number;
    if (!beforeCard) {
      // 섹션 끝에
      pos = list.length ? posOf(list[list.length - 1]) + 1000 : Date.now();
    } else {
      const idx = list.findIndex((c) => c.id === beforeCard.id);
      const prev = idx > 0 ? posOf(list[idx - 1]) : posOf(beforeCard) - 2000;
      pos = (prev + posOf(beforeCard)) / 2;
    }
    updateCard(card, { section_id: sectionId, pos });
    if (effectiveSort !== "manual") setSortMode("manual");
  }, [dragCardId, cards, cardsBySection, updateCard, effectiveSort]);

  // ── CSV 내보내기 ─────────────────────────────────────────────────────
  const exportCsv = useCallback(() => {
    const esc = (s: string) => `"${(s || "").replace(/"/g, '""')}"`;
    const rows = [["섹션", "제목", "내용", "작성자", "작성시각", "좋아요", "댓글수", "링크"].join(",")];
    sections.forEach((s) => {
      (cardsBySection.get(s.id) || []).forEach((c) => {
        rows.push([
          esc(s.name), esc(c.title || ""), esc(c.text), esc(c.author_name),
          esc(new Date(c.created).toLocaleString("ko-KR")),
          String(likeCount(c.id)), String((comments.get(c.id) || []).length),
          esc(c.link_url || ""),
        ].join(","));
      });
    });
    const blob = new Blob(["﻿" + rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${meta?.title || "board"}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [sections, cardsBySection, likeCount, comments, meta?.title]);

  // ── 렌더 ─────────────────────────────────────────────────────────────
  if (error) {
    return <div className="p-10 text-center text-body text-status-error">{error}</div>;
  }
  if (!meta) {
    return (
      <div className="flex items-center justify-center py-24 text-text-tertiary">
        <Loader2 size={20} className="animate-spin mr-2" /> 보드 불러오는 중...
      </div>
    );
  }

  const bg = backgroundOf(meta.background);
  const tx = bg.dark ? "text-white" : "text-gray-900";
  const sub = bg.dark ? "text-white/70" : "text-gray-700/80";
  const chip = bg.dark ? "bg-white/15 text-white" : "bg-white/60 text-gray-800";
  const sortLabel = { newest: "최신순", likes: "좋아요순", manual: "수동" }[effectiveSort];
  const pendingCount = isModerator
    ? cards.filter((c) => c.approved === false).length
    : 0;

  return (
    <div
      className="rounded-2xl overflow-hidden shadow-lg min-h-[78vh] flex flex-col relative"
      style={{ background: bg.css }}
    >
      {/* Padlet 식 상단 — 우측 툴바 행 + 좌측 작성자·제목 */}
      <div className="px-5 sm:px-7 pt-4 pb-3">
        <div className="flex items-center justify-end gap-1.5 flex-wrap mb-1">
          {/* 검색 */}
          {searchOpen ? (
            <span className={`inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded-full ${chip}`}>
              <Search size={12} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") { setQuery(""); setSearchOpen(false); } }}
                autoFocus
                placeholder="카드 검색"
                className="bg-transparent outline-none text-[12px] w-28 placeholder:opacity-60"
              />
              <button onClick={() => { setQuery(""); setSearchOpen(false); }} className="p-0.5 opacity-60 hover:opacity-100">
                <X size={11} />
              </button>
            </span>
          ) : (
            <button onClick={() => setSearchOpen(true)} className={`p-1.5 rounded-full ${chip} hover:opacity-80`} title="검색">
              <Search size={13} />
            </button>
          )}
          {/* 슬라이드쇼 */}
          <button
            onClick={() => sortedFlat.length > 0 && setSlideshow(true)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11.5px] font-medium ${chip} hover:opacity-80`}
            title="슬라이드쇼 — 카드를 한 장씩 크게"
          >
            <Play size={11} /> 슬라이드쇼
          </button>
          <button
            onClick={() => setSortMode(
              effectiveSort === "newest" ? "likes" : effectiveSort === "likes" ? "manual" : "newest",
            )}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] ${chip} hover:opacity-80`}
            title="정렬 전환 (최신순 → 좋아요순 → 수동)"
          >
            <ArrowDownWideNarrow size={11} /> {sortLabel}
          </button>
          {pendingCount > 0 && (
            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] bg-amber-400/90 text-amber-950`}>
              <ShieldCheck size={11} /> 승인 대기 {pendingCount}
            </span>
          )}
          {isModerator && (
            <button onClick={exportCsv} className={`p-1.5 rounded-full ${chip} hover:opacity-80`} title="CSV 내보내기">
              <Download size={13} />
            </button>
          )}
          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] ${chip}`}>
            {connected
              ? <Wifi size={11} className="text-emerald-500" />
              : synced
                ? <WifiOff size={11} className="text-red-400" />
                : <Loader2 size={11} className="animate-spin" />}
            {connected ? `${Math.max(activeCount, 1)}명` : synced ? "재연결 중" : "연결 중"}
          </span>
          {meta.is_archived && (
            <span className={`px-2 py-1 rounded-full text-[11px] ${chip}`}>보관됨 · 읽기 전용</span>
          )}
          {role === "viewer" && (
            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] ${chip}`}>
              <Eye size={11} /> 공유받음 · 열람 전용
            </span>
          )}
          {headerActions}
        </div>
        <div className={`text-[11.5px] ${sub}`}>
          {meta.owner_name || ""}{meta.description ? ` · ${meta.description}` : ""}
        </div>
        <h2 className={`text-3xl font-extrabold tracking-tight ${tx} drop-shadow-sm`}>
          {meta.title}
        </h2>
      </div>

      {/* 레이아웃: wall(담벼락 masonry) | canvas(자유배치) | shelf(섹션 컬럼) */}
      {meta.layout === "wall" ? (
        <div className="flex-1 px-4 sm:px-6 pb-24">
          {sortedFlat.length === 0 && synced && (
            <div className={`text-center py-20 text-body ${sub}`}>
              {canWrite ? "오른쪽 아래 + 게시 버튼으로 첫 카드를 붙여보세요" : "아직 카드가 없습니다"}
            </div>
          )}
          <div style={{ columnWidth: 270, columnGap: 14 }}>
            {sortedFlat.map((c) => (
              <div key={c.id} className="mb-3.5" style={{ breakInside: "avoid" }}>
                <CardItem
                  card={c}
                  canEdit={canWrite && (c.author_id === user?.id || isModerator)}
                  canLike={canWrite}
                  isModerator={isModerator}
                  hideAuthors={hideAuthors}
                  myUserId={user?.id}
                  likeCount={likeCount(c.id)}
                  liked={iLiked(c.id)}
                  comments={comments.get(c.id) || []}
                  draggable={false}
                  onDragStart={() => undefined}
                  onDragEnd={() => undefined}
                  onDropBefore={() => undefined}
                  dragActive={false}
                  onUpdate={updateCard}
                  onDelete={deleteCard}
                  onToggleLike={() => toggleLike(c)}
                  onAddComment={(t) => addComment(c, t)}
                  onDeleteComment={deleteComment}
                />
              </div>
            ))}
          </div>
        </div>
      ) : meta.layout === "canvas" ? (
        <CanvasArea
          dark={!!bg.dark}
          cards={visibleCards}
          firstSectionId={sections[0]?.id ?? "col-0"}
          canWrite={canWrite}
          isModerator={isModerator}
          hideAuthors={hideAuthors}
          myUserId={user?.id}
          boardId={boardId}
          likeCount={likeCount}
          iLiked={iLiked}
          comments={comments}
          onAdd={addCard}
          onUpdate={updateCard}
          onDelete={deleteCard}
          onToggleLike={toggleLike}
          onAddComment={addComment}
          onDeleteComment={deleteComment}
        />
      ) : (
      <div className="flex-1 flex gap-3 sm:gap-4 items-start px-4 sm:px-6 pb-6 overflow-x-auto">
        {sections.map((s, si) => (
          <BoardColumn
            key={s.id}
            boardId={boardId}
            section={s}
            index={si}
            total={sections.length}
            dark={!!bg.dark}
            cards={cardsBySection.get(s.id) || []}
            canWrite={canWrite}
            connecting={!synced}
            isModerator={isModerator}
            hideAuthors={hideAuthors}
            requiresApproval={requiresApproval}
            myUserId={user?.id}
            likeCount={likeCount}
            iLiked={iLiked}
            comments={comments}
            dragCardId={dragCardId}
            setDragCardId={setDragCardId}
            onDrop={handleDrop}
            onAdd={(p) => addCard(s.id, p)}
            onUpdate={updateCard}
            onDelete={deleteCard}
            onToggleLike={toggleLike}
            onAddComment={addComment}
            onDeleteComment={deleteComment}
            onRename={(name) => renameSection(s.id, name)}
            onDeleteSection={() => deleteSection(s.id)}
            onMove={(dir) => moveSection(s.id, dir)}
          />
        ))}
        {isModerator && canWrite && (
          <button
            onClick={addSection}
            className={`flex-shrink-0 w-[200px] min-h-[120px] rounded-2xl border-2 border-dashed transition flex flex-col items-center justify-center gap-1.5 ${
              bg.dark
                ? "border-white/30 text-white/70 hover:border-white/60 hover:text-white"
                : "border-gray-500/30 text-gray-600/80 hover:border-gray-600/60 hover:text-gray-800"
            }`}
          >
            <Plus size={20} />
            <span className="text-caption font-semibold">섹션 추가</span>
          </button>
        )}
      </div>
      )}

      {/* Padlet 식 우하단 "+ 게시" (wall·shelf — canvas는 자체 버튼) */}
      {canWrite && meta.layout !== "canvas" && !wallComposing && (
        <button
          onClick={() => setWallComposing(true)}
          className="absolute bottom-6 right-6 z-20 inline-flex items-center gap-1.5 px-5 py-3 rounded-full bg-teal-500 hover:bg-teal-600 text-white text-body font-semibold shadow-xl transition"
          title="카드 게시"
        >
          <Plus size={18} /> 게시
        </button>
      )}
      {wallComposing && (
        <div className="absolute bottom-6 right-6 z-30 w-[320px] max-w-[calc(100%-3rem)]">
          <Composer
            boardId={boardId}
            onSubmit={(p) => {
              addCard(sections[0]?.id ?? "col-0", p);
              setWallComposing(false);
            }}
            onCancel={() => setWallComposing(false)}
          />
        </div>
      )}

      {/* 슬라이드쇼 */}
      {slideshow && sortedFlat.length > 0 && (
        <Slideshow
          cards={sortedFlat}
          hideAuthors={hideAuthors}
          isModerator={isModerator}
          myUserId={user?.id}
          likeCount={likeCount}
          onClose={() => setSlideshow(false)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 슬라이드쇼 — 카드를 한 장씩 풀스크린 (Padlet 슬라이드쇼)
// ─────────────────────────────────────────────────────────────────────────────

function Slideshow({
  cards, hideAuthors, isModerator, myUserId, likeCount, onClose,
}: {
  cards: BoardCard[];
  hideAuthors: boolean;
  isModerator: boolean;
  myUserId?: number;
  likeCount: (cardId: string) => number;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const card = cards[Math.min(idx, cards.length - 1)];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" || e.key === " ") setIdx((i) => Math.min(i + 1, cards.length - 1));
      if (e.key === "ArrowLeft") setIdx((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cards.length, onClose]);

  if (!card) return null;
  const authorLabel = hideAuthors && !isModerator && card.author_id !== myUserId
    ? "익명" : card.author_name;

  return (
    <div className="fixed inset-0 z-[80] bg-black/90 flex flex-col">
      <div className="flex items-center justify-between px-5 py-3">
        <span className="text-white/70 text-caption font-mono">
          {idx + 1} / {cards.length}
        </span>
        <button onClick={onClose} className="p-2 text-white/70 hover:text-white rounded-full hover:bg-white/10">
          <X size={20} />
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center gap-3 px-4 pb-8 min-h-0">
        <button
          onClick={() => setIdx((i) => Math.max(i - 1, 0))}
          disabled={idx === 0}
          className="p-3 text-white/70 hover:text-white disabled:opacity-20 rounded-full hover:bg-white/10 flex-shrink-0"
        >
          <ChevronLeft size={28} />
        </button>
        <div
          className="rounded-2xl shadow-2xl max-w-2xl w-full max-h-full overflow-y-auto p-7"
          style={{ backgroundColor: card.color || "#ffffff" }}
        >
          <div className="flex items-center gap-2 mb-3">
            <span
              className="w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold text-white flex-shrink-0"
              style={{ backgroundColor: avatarColor(authorLabel || "") }}
            >
              {(authorLabel || "?").charAt(0)}
            </span>
            <div>
              <div className="text-body font-semibold">{authorLabel}</div>
              <div className="text-[11px] text-gray-500">{relTime(card.created)}</div>
            </div>
          </div>
          {card.title && <div className="text-2xl font-extrabold mb-2 break-words">{card.title}</div>}
          {card.image_url && (
            <AuthedImg url={card.image_url} className="rounded-xl w-full max-h-[45vh] object-contain mb-3" />
          )}
          {card.text && (
            <div className="text-lg whitespace-pre-wrap break-words leading-relaxed">{card.text}</div>
          )}
          {card.link_url && <LinkPreview url={card.link_url} />}
          {likeCount(card.id) > 0 && (
            <div className="flex items-center gap-1 mt-4 text-rose-500 text-body">
              <Heart size={16} fill="currentColor" /> {likeCount(card.id)}
            </div>
          )}
        </div>
        <button
          onClick={() => setIdx((i) => Math.min(i + 1, cards.length - 1))}
          disabled={idx >= cards.length - 1}
          className="p-3 text-white/70 hover:text-white disabled:opacity-20 rounded-full hover:bg-white/10 flex-shrink-0"
        >
          <ChevronRight size={28} />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 자유배치 캔버스 (Padlet canvas — 카드 드래그로 x/y 이동)
// ─────────────────────────────────────────────────────────────────────────────

const CANVAS_W = 1600;
const CANVAS_H = 1100;
const CANVAS_CARD_W = 250;

function CanvasArea(props: {
  dark: boolean;
  cards: BoardCard[];
  firstSectionId: string;
  canWrite: boolean;
  isModerator: boolean;
  hideAuthors: boolean;
  myUserId?: number;
  boardId: number;
  likeCount: (cardId: string) => number;
  iLiked: (cardId: string) => boolean;
  comments: Map<string, BoardComment[]>;
  onAdd: (sectionId: string, p: {
    title?: string; text: string; color: string; image_url?: string; link_url?: string;
    cx?: number; cy?: number;
  }) => void;
  onUpdate: (card: BoardCard, patch: Partial<BoardCard>) => void;
  onDelete: (card: BoardCard) => void;
  onToggleLike: (card: BoardCard) => void;
  onAddComment: (card: BoardCard, text: string) => void;
  onDeleteComment: (c: BoardComment) => void;
}) {
  const { cards, canWrite, onUpdate } = props;
  const areaRef = useRef<HTMLDivElement>(null);
  const [composing, setComposing] = useState(false);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [livePos, setLivePos] = useState<{ id: string; x: number; y: number } | null>(null);

  // cx/cy 없는 카드는 index 기반 자동 배치
  const posOfCard = (c: BoardCard, i: number) => ({
    x: typeof c.cx === "number" ? c.cx : 30 + (i % 5) * (CANVAS_CARD_W + 20),
    y: typeof c.cy === "number" ? c.cy : 30 + Math.floor(i / 5) * 200,
  });

  const areaPoint = (e: { clientX: number; clientY: number }) => {
    const el = areaRef.current!;
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left + el.scrollLeft, y: e.clientY - r.top + el.scrollTop };
  };

  const startDrag = (c: BoardCard, i: number) => (e: React.PointerEvent) => {
    if (!canWrite) return;
    const t = e.target as HTMLElement;
    // 버튼·입력·링크 위에서는 드래그 시작 안 함 (카드 상호작용 보존)
    if (t.closest("button,textarea,input,a")) return;
    const editable = c.author_id === props.myUserId || props.isModerator;
    if (!editable) return;
    const p = areaPoint(e);
    const cur = posOfCard(c, i);
    setDrag({ id: c.id, dx: p.x - cur.x, dy: p.y - cur.y });
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = areaPoint(e);
    setLivePos({
      id: drag.id,
      x: Math.max(0, Math.min(CANVAS_W - CANVAS_CARD_W, p.x - drag.dx)),
      y: Math.max(0, Math.min(CANVAS_H - 60, p.y - drag.dy)),
    });
  };

  const endDrag = () => {
    if (drag && livePos && livePos.id === drag.id) {
      const card = cards.find((c) => c.id === drag.id);
      if (card) onUpdate(card, { cx: livePos.x, cy: livePos.y });
    }
    setDrag(null);
    setLivePos(null);
  };

  return (
    <div className="flex-1 px-4 sm:px-6 pb-6 relative">
      <div
        ref={areaRef}
        className={`relative rounded-2xl overflow-auto ${props.dark ? "bg-white/5" : "bg-white/30"}`}
        style={{ height: "70vh" }}
        onPointerMove={onMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
      >
        <div className="relative" style={{ width: CANVAS_W, height: CANVAS_H }}>
          {cards.map((c, i) => {
            const base = posOfCard(c, i);
            const pos = livePos && livePos.id === c.id ? livePos : base;
            return (
              <div
                key={c.id}
                className="absolute"
                style={{
                  left: pos.x, top: pos.y, width: CANVAS_CARD_W,
                  zIndex: drag?.id === c.id ? 30 : 1,
                  cursor: canWrite && (c.author_id === props.myUserId || props.isModerator) ? "grab" : "default",
                }}
                onPointerDown={startDrag(c, i)}
              >
                <CardItem
                  card={c}
                  canEdit={canWrite && (c.author_id === props.myUserId || props.isModerator)}
                  canLike={canWrite}
                  isModerator={props.isModerator}
                  hideAuthors={props.hideAuthors}
                  myUserId={props.myUserId}
                  likeCount={props.likeCount(c.id)}
                  liked={props.iLiked(c.id)}
                  comments={props.comments.get(c.id) || []}
                  draggable={false}
                  onDragStart={() => undefined}
                  onDragEnd={() => undefined}
                  onDropBefore={() => undefined}
                  dragActive={false}
                  onUpdate={props.onUpdate}
                  onDelete={props.onDelete}
                  onToggleLike={() => props.onToggleLike(c)}
                  onAddComment={(t) => props.onAddComment(c, t)}
                  onDeleteComment={props.onDeleteComment}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* 카드 추가 — 우하단 플로팅 */}
      {canWrite && !composing && (
        <button
          onClick={() => setComposing(true)}
          className="absolute bottom-10 right-10 w-12 h-12 rounded-full bg-rose-500 hover:bg-rose-600 text-white flex items-center justify-center shadow-xl transition z-20"
          title="카드 추가"
        >
          <Plus size={22} />
        </button>
      )}
      {composing && (
        <div className="absolute bottom-10 right-10 w-[280px] z-30">
          <Composer
            boardId={props.boardId}
            onSubmit={(p) => {
              props.onAdd(props.firstSectionId, {
                ...p,
                cx: 40 + (cards.length % 6) * 60,
                cy: 40 + (cards.length % 5) * 60,
              });
              setComposing(false);
            }}
            onCancel={() => setComposing(false)}
          />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 섹션 컬럼
// ─────────────────────────────────────────────────────────────────────────────

function BoardColumn(props: {
  boardId: number;
  section: BoardSection;
  index: number;
  total: number;
  dark: boolean;
  cards: BoardCard[];
  canWrite: boolean;
  connecting: boolean;
  isModerator: boolean;
  hideAuthors: boolean;
  requiresApproval: boolean;
  myUserId?: number;
  likeCount: (cardId: string) => number;
  iLiked: (cardId: string) => boolean;
  comments: Map<string, BoardComment[]>;
  dragCardId: string | null;
  setDragCardId: (id: string | null) => void;
  onDrop: (sectionId: string, beforeCard: BoardCard | null) => void;
  onAdd: (p: { title?: string; text: string; color: string; image_url?: string; link_url?: string }) => void;
  onUpdate: (card: BoardCard, patch: Partial<BoardCard>) => void;
  onDelete: (card: BoardCard) => void;
  onToggleLike: (card: BoardCard) => void;
  onAddComment: (card: BoardCard, text: string) => void;
  onDeleteComment: (c: BoardComment) => void;
  onRename: (name: string) => void;
  onDeleteSection: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const {
    section, index, total, dark, cards, canWrite, connecting, isModerator,
    dragCardId, setDragCardId, onDrop, onAdd, onRename, onDeleteSection, onMove,
  } = props;
  const [composing, setComposing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(section.name);

  const panel = dark ? "bg-white/10" : "bg-white/45";
  const headTx = dark ? "text-white" : "text-gray-900";
  const countChip = dark ? "bg-white/20 text-white" : "bg-white/70 text-gray-700";
  const ctl = dark ? "text-white/60 hover:text-white" : "text-gray-500 hover:text-gray-800";

  return (
    <div
      className={`${panel} backdrop-blur-[2px] rounded-2xl p-2.5 min-h-[220px] w-[280px] sm:w-[300px] flex-shrink-0 ${
        dragCardId ? "outline-dashed outline-1 outline-rose-300/60" : ""
      }`}
      onDragOver={(e) => { if (dragCardId) e.preventDefault(); }}
      onDrop={(e) => { e.preventDefault(); onDrop(section.id, null); }}
    >
      <div className="flex items-center justify-between mb-2 px-1.5 pt-0.5 group/sec">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {renaming ? (
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { onRename(nameDraft); setRenaming(false); }
                if (e.key === "Escape") setRenaming(false);
              }}
              onBlur={() => { onRename(nameDraft); setRenaming(false); }}
              autoFocus
              className="text-body font-bold bg-white/80 rounded px-1.5 py-0.5 outline-none w-full max-w-[160px]"
            />
          ) : (
            <span
              className={`text-body font-bold truncate ${headTx} ${isModerator && canWrite ? "cursor-text" : ""}`}
              onClick={() => { if (isModerator && canWrite) { setNameDraft(section.name); setRenaming(true); } }}
              title={isModerator ? "클릭하여 이름 수정" : undefined}
            >
              {section.name}
            </span>
          )}
          <span className={`px-1.5 py-0.5 rounded-full text-[10.5px] font-semibold ${countChip}`}>
            {cards.length}
          </span>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {isModerator && canWrite && (
            <span className="flex items-center gap-0.5 opacity-0 group-hover/sec:opacity-100 transition">
              <button onClick={() => onMove(-1)} disabled={index === 0} className={`p-0.5 rounded ${ctl} disabled:opacity-20`} title="왼쪽으로">
                <ChevronLeft size={13} />
              </button>
              <button onClick={() => onMove(1)} disabled={index === total - 1} className={`p-0.5 rounded ${ctl} disabled:opacity-20`} title="오른쪽으로">
                <ChevronRight size={13} />
              </button>
              <button onClick={onDeleteSection} className={`p-0.5 rounded ${ctl} hover:!text-red-500`} title="섹션 삭제">
                <Trash2 size={13} />
              </button>
            </span>
          )}
          {canWrite && !composing && (
            <button
              onClick={() => setComposing(true)}
              className="w-7 h-7 rounded-full bg-rose-500 hover:bg-rose-600 text-white flex items-center justify-center shadow-md transition flex-shrink-0 ml-0.5"
              title="카드 추가"
            >
              <Plus size={15} />
            </button>
          )}
          {connecting && (
            <span className={`text-[10px] ml-1 ${dark ? "text-white/60" : "text-gray-500"}`}>연결 중…</span>
          )}
        </div>
      </div>

      <div className="space-y-2.5">
        {composing && (
          <Composer
            boardId={props.boardId}
            onSubmit={(p) => { onAdd(p); setComposing(false); }}
            onCancel={() => setComposing(false)}
          />
        )}
        {cards.map((c) => (
          <CardItem
            key={c.id}
            card={c}
            canEdit={canWrite && (c.author_id === props.myUserId || isModerator)}
            canLike={canWrite}
            isModerator={isModerator}
            hideAuthors={props.hideAuthors}
            myUserId={props.myUserId}
            likeCount={props.likeCount(c.id)}
            liked={props.iLiked(c.id)}
            comments={props.comments.get(c.id) || []}
            draggable={canWrite && (c.author_id === props.myUserId || isModerator)}
            onDragStart={() => setDragCardId(c.id)}
            onDragEnd={() => setDragCardId(null)}
            onDropBefore={() => onDrop(section.id, c)}
            dragActive={!!dragCardId && dragCardId !== c.id}
            onUpdate={props.onUpdate}
            onDelete={props.onDelete}
            onToggleLike={() => props.onToggleLike(c)}
            onAddComment={(t) => props.onAddComment(c, t)}
            onDeleteComment={props.onDeleteComment}
          />
        ))}
        {!composing && cards.length === 0 && !connecting && (
          <div className={`text-center text-[11.5px] py-6 ${dark ? "text-white/50" : "text-gray-500/80"}`}>
            아직 카드가 없습니다
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 카드 컴포저 (제목 + 본문 + 이미지 + 링크 + 색)
// ─────────────────────────────────────────────────────────────────────────────

function ColorDots({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      {CARD_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={`w-[18px] h-[18px] rounded-full border transition ${
            value === c ? "ring-2 ring-rose-400 border-white" : "border-black/15 hover:scale-110"
          }`}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  );
}

function Composer({
  boardId, onSubmit, onCancel,
}: {
  boardId: number;
  onSubmit: (p: { title?: string; text: string; color: string; image_url?: string; link_url?: string }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [draft, setDraft] = useState("");
  const [color, setColor] = useState(CARD_COLORS[0]);
  const [imageUrl, setImageUrl] = useState<string | undefined>();
  const [linkUrl, setLinkUrl] = useState<string | undefined>();
  const [linkInput, setLinkInput] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    if (!draft.trim() && !imageUrl) return;
    onSubmit({ title: title || undefined, text: draft, color, image_url: imageUrl, link_url: linkUrl });
  };

  const uploadImage = async (f: File) => {
    setUploading(true);
    try {
      const res = await api.upload<{ url: string }>(
        `/api/classroom/boards/${boardId}/upload-image`, f,
      );
      setImageUrl(res.url);
    } catch (e: any) {
      alert(e?.detail || "이미지 업로드 실패");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const confirmLink = () => {
    const v = linkDraft.trim();
    if (v) {
      setLinkUrl(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    }
    setLinkInput(false);
    setLinkDraft("");
  };

  return (
    <div className="rounded-xl p-3 shadow-lg border border-black/5" style={{ backgroundColor: color }}>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="제목 (선택)"
        className="w-full text-body font-semibold outline-none bg-transparent placeholder:text-gray-400 mb-1"
      />
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit();
          if (e.key === "Escape") onCancel();
        }}
        rows={3}
        placeholder="내용 입력… (Ctrl+Enter 등록)"
        autoFocus
        className="w-full text-body outline-none resize-none bg-transparent placeholder:text-gray-400"
      />
      {imageUrl && (
        <div className="relative mt-1.5">
          <AuthedImg url={imageUrl} className="rounded-lg max-h-40 w-full object-cover" />
          <button
            onClick={() => setImageUrl(undefined)}
            className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/50 text-white flex items-center justify-center"
          >
            <X size={11} />
          </button>
        </div>
      )}
      {linkUrl && (
        <div className="flex items-center gap-1 mt-1.5 text-[11px] text-sky-700 bg-sky-50 rounded-lg px-2 py-1">
          <LinkIcon size={11} className="flex-shrink-0" />
          <span className="truncate flex-1">{linkUrl}</span>
          <button onClick={() => setLinkUrl(undefined)} className="text-gray-400 hover:text-gray-700">
            <X size={11} />
          </button>
        </div>
      )}
      {linkInput && (
        <div className="flex items-center gap-1 mt-1.5">
          <input
            value={linkDraft}
            onChange={(e) => setLinkDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") confirmLink(); if (e.key === "Escape") setLinkInput(false); }}
            placeholder="https://..."
            autoFocus
            className="flex-1 text-[12px] px-2 py-1 rounded-lg border border-black/10 outline-none bg-white/80"
          />
          <button onClick={confirmLink} className="text-[11px] px-2 py-1 bg-sky-500 text-white rounded-lg">확인</button>
        </div>
      )}
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-2">
          <ColorDots value={color} onChange={setColor} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="p-1 text-gray-500 hover:text-gray-800 rounded disabled:opacity-40"
            title="이미지 첨부"
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
          </button>
          <button
            onClick={() => setLinkInput((v) => !v)}
            className="p-1 text-gray-500 hover:text-gray-800 rounded"
            title="링크 첨부"
          >
            <LinkIcon size={14} />
          </button>
          <input
            ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(f); }}
          />
        </div>
        <div className="flex gap-1">
          <button onClick={onCancel} className="px-2 py-1 text-caption text-gray-500 hover:bg-black/5 rounded-lg">
            취소
          </button>
          <button
            onClick={submit}
            disabled={(!draft.trim() && !imageUrl) || uploading}
            className="px-3 py-1 text-caption bg-rose-500 hover:bg-rose-600 disabled:opacity-40 text-white rounded-lg font-semibold shadow-sm"
          >
            등록
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 카드
// ─────────────────────────────────────────────────────────────────────────────

function CardItem({
  card, canEdit, canLike, isModerator, hideAuthors, myUserId,
  likeCount, liked, comments,
  draggable, onDragStart, onDragEnd, onDropBefore, dragActive,
  onUpdate, onDelete, onToggleLike, onAddComment, onDeleteComment,
}: {
  card: BoardCard;
  canEdit: boolean;
  canLike: boolean;
  isModerator: boolean;
  hideAuthors: boolean;
  myUserId?: number;
  likeCount: number;
  liked: boolean;
  comments: BoardComment[];
  draggable: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropBefore: () => void;
  dragActive: boolean;
  onUpdate: (card: BoardCard, patch: Partial<BoardCard>) => void;
  onDelete: (card: BoardCard) => void;
  onToggleLike: () => void;
  onAddComment: (text: string) => void;
  onDeleteComment: (c: BoardComment) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(card.title || "");
  const [draft, setDraft] = useState(card.text);
  const [color, setColor] = useState(card.color || CARD_COLORS[0]);
  const [showComments, setShowComments] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");

  const pending = card.approved === false;
  const isMine = card.author_id === myUserId;
  const authorLabel = hideAuthors && !isModerator && !isMine ? "익명" : card.author_name;

  const save = () => {
    const patch: Partial<BoardCard> = {};
    const t = titleDraft.trim().slice(0, 150);
    if (t !== (card.title || "")) patch.title = t || undefined;
    if (draft.trim() && draft !== card.text) patch.text = draft.trim().slice(0, 2000);
    if (color !== card.color) patch.color = color;
    if (Object.keys(patch).length > 0) onUpdate(card, patch);
    setEditing(false);
  };

  return (
    <div
      className={`rounded-xl shadow-md border group transition hover:shadow-lg hover:-translate-y-px ${
        pending ? "border-amber-400 border-dashed" : "border-black/5"
      }`}
      style={{ backgroundColor: card.color || "#ffffff" }}
      draggable={draggable && !editing}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStart(); }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => { if (dragActive) { e.preventDefault(); e.stopPropagation(); } }}
      onDrop={(e) => { if (dragActive) { e.preventDefault(); e.stopPropagation(); onDropBefore(); } }}
    >
      <div className="p-3">
        {pending && (
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-bold text-amber-700 bg-amber-100 rounded-full px-2 py-0.5">
              승인 대기
            </span>
            {isModerator && (
              <button
                onClick={() => onUpdate(card, { approved: true })}
                className="text-[10.5px] font-semibold text-white bg-emerald-500 hover:bg-emerald-600 rounded-full px-2 py-0.5"
              >
                승인
              </button>
            )}
          </div>
        )}
        {editing ? (
          <div>
            <input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              placeholder="제목 (선택)"
              className="w-full text-body font-semibold outline-none bg-transparent placeholder:text-gray-400 mb-0.5"
            />
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save();
                if (e.key === "Escape") setEditing(false);
              }}
              rows={3}
              autoFocus
              className="w-full text-body outline-none resize-none bg-transparent"
            />
            {card.image_url && (
              <button
                onClick={() => onUpdate(card, { image_url: undefined })}
                className="text-[11px] text-red-500 hover:underline"
              >
                이미지 제거
              </button>
            )}
            {card.link_url && (
              <button
                onClick={() => onUpdate(card, { link_url: undefined })}
                className="text-[11px] text-red-500 hover:underline ml-2"
              >
                링크 제거
              </button>
            )}
            <div className="flex items-center justify-between mt-1">
              <ColorDots value={color} onChange={setColor} />
              <div className="flex gap-0.5">
                <button onClick={() => setEditing(false)} className="p-1 text-gray-400 hover:bg-black/5 rounded">
                  <X size={13} />
                </button>
                <button onClick={save} className="p-1 text-emerald-600 hover:bg-black/5 rounded">
                  <Check size={13} />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Padlet 카드: 상단 작성자 헤더 (아바타 + 이름 + 시간 | 수정·삭제) */}
            <div className="flex items-center justify-between gap-1 mb-1.5">
              <span className="flex items-center gap-2 min-w-0">
                <span
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold text-white flex-shrink-0"
                  style={{ backgroundColor: avatarColor(authorLabel || "") }}
                >
                  {(authorLabel || "?").charAt(0)}
                </span>
                <span className="min-w-0">
                  <span className="block text-[12px] font-semibold text-gray-800 truncate leading-tight">
                    {authorLabel}
                  </span>
                  <span className="block text-[10.5px] text-gray-400 leading-tight">
                    {relTime(card.created)}
                  </span>
                </span>
              </span>
              {canEdit && (
                <span className="flex gap-0.5 opacity-0 group-hover:opacity-100 flex-shrink-0">
                  <button
                    onClick={() => {
                      setTitleDraft(card.title || ""); setDraft(card.text);
                      setColor(card.color || CARD_COLORS[0]); setEditing(true);
                    }}
                    className="p-1 text-gray-400 hover:text-gray-700 rounded" title="수정"
                  >
                    <Pencil size={12} />
                  </button>
                  <button onClick={() => onDelete(card)} className="p-1 text-gray-400 hover:text-red-600 rounded" title="삭제">
                    <Trash2 size={12} />
                  </button>
                </span>
              )}
            </div>

            {card.title && (
              <div className="text-body font-bold break-words mb-0.5">{card.title}</div>
            )}
            {card.image_url && (
              <AuthedImg url={card.image_url} className="rounded-lg w-full max-h-56 object-cover my-1.5" />
            )}
            {card.text && (
              <div className="text-body whitespace-pre-wrap break-words leading-relaxed">{card.text}</div>
            )}
            {card.link_url && <LinkPreview url={card.link_url} />}

            {/* 하단 반응 행 (Padlet: 하트 · 댓글 추가) */}
            <div className="flex items-center gap-2 mt-2.5 pt-2 border-t border-black/10">
              <button
                onClick={onToggleLike}
                disabled={!canLike}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11.5px] transition ${
                  liked ? "text-rose-500 bg-rose-50" : "text-gray-400 hover:text-rose-400 hover:bg-rose-50/60"
                } disabled:opacity-40`}
                title="좋아요"
              >
                <Heart size={13} fill={liked ? "currentColor" : "none"} />
                {likeCount > 0 && <span className="font-semibold">{likeCount}</span>}
              </button>
              <button
                onClick={() => setShowComments((v) => !v)}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11.5px] transition ${
                  comments.length > 0 ? "text-sky-600 bg-sky-50/70" : "text-gray-400 hover:text-sky-500 hover:bg-sky-50/60"
                }`}
                title="댓글"
              >
                <MessageCircle size={13} />
                {comments.length > 0 ? <span className="font-semibold">{comments.length}</span> : "댓글 추가"}
              </button>
            </div>

            {/* 댓글 스레드 */}
            {showComments && (
              <div className="mt-2 pt-2 border-t border-black/10 space-y-1.5">
                {comments.map((cm) => (
                  <div key={cm.id} className="flex items-start gap-1.5 group/cm">
                    <span
                      className="w-4 h-4 rounded-full flex items-center justify-center text-[8.5px] font-bold text-white flex-shrink-0 mt-0.5"
                      style={{ backgroundColor: avatarColor(cm.author_name || "") }}
                    >
                      {(cm.author_name || "?").charAt(0)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="text-[11px] font-semibold text-gray-700">
                        {hideAuthors && !isModerator && cm.author_id !== myUserId ? "익명" : cm.author_name}
                      </span>
                      <span className="text-[11.5px] text-gray-700 ml-1 break-words">{cm.text}</span>
                    </div>
                    {(cm.author_id === myUserId || isModerator) && canLike && (
                      <button
                        onClick={() => onDeleteComment(cm)}
                        className="p-0.5 text-gray-300 hover:text-red-500 opacity-0 group-hover/cm:opacity-100 flex-shrink-0"
                      >
                        <X size={10} />
                      </button>
                    )}
                  </div>
                ))}
                {canLike && (
                  <input
                    value={commentDraft}
                    onChange={(e) => setCommentDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && commentDraft.trim()) {
                        onAddComment(commentDraft);
                        setCommentDraft("");
                      }
                    }}
                    placeholder="댓글 입력 후 Enter"
                    className="w-full text-[11.5px] px-2 py-1 rounded-lg border border-black/10 outline-none bg-white/70 focus:bg-white"
                  />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
