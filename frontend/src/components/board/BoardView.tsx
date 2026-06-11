"use client";

/**
 * 보드 (Padlet형) — 실시간 협업 담벼락. 교사/학생 공유 컴포넌트.
 *
 * 카드 데이터는 Yjs Y.Map("cards") — key=cardId, value=카드 객체.
 * HocuspocusProvider name=`board-{id}` (doc-/deck-/sheet- 패턴).
 * 카드 단위 LWW (같은 카드 동시 수정은 마지막 쓰기 승리 — 학교 환경 OK).
 *
 * UX (Padlet 동일 지향):
 *  - 배경 테마 월(wall) + 반투명 컬럼 패널 + 흰 카드(색 선택)
 *  - 메타 로드 즉시 월·컬럼 렌더 (Yjs 연결은 배경에서 — "연결 중" 칩만)
 *  - 새 카드는 컬럼 맨 위에 (최신 우선), 작성자 아바타 + 상대 시간
 *  - 컬럼 헤더의 + 로 즉시 작성, Ctrl+Enter 등록
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import {
  Loader2, Plus, Trash2, Pencil, Check, X, Users, Wifi, WifiOff, Eye,
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
  permission: { can_read: boolean; can_write: boolean; role: string | null };
}

export interface BoardCard {
  id: string;
  text: string;
  color: string;
  column: number;
  author_id: number;
  author_name: string;
  created: number; // epoch ms
}

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

export function BoardView({
  boardId, headerActions,
}: {
  boardId: number;
  /** 페이지별 액션 버튼 (설정/공유/새창 등) — 월 헤더 우측에 렌더 */
  headerActions?: ReactNode;
}) {
  const { user } = useAuth();
  const [meta, setMeta] = useState<BoardMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<BoardCard[]>([]);
  const [connected, setConnected] = useState(false);
  const [synced, setSynced] = useState(false);
  const [activeCount, setActiveCount] = useState(0);

  const yCardsRef = useRef<Y.Map<any> | null>(null);

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

  // ── Yjs + Hocuspocus (메타와 병행 — 월은 메타만으로 즉시 렌더) ─────────
  useEffect(() => {
    if (!meta) return;
    const yDoc = new Y.Doc();
    const yCards = yDoc.getMap<any>("cards");
    yCardsRef.current = yCards;

    const readCards = () => {
      const out: BoardCard[] = [];
      yCards.forEach((v) => {
        if (v && typeof v === "object" && v.id) out.push(v as BoardCard);
      });
      out.sort((a, b) => (b.created || 0) - (a.created || 0)); // 최신 먼저 (Padlet식)
      setCards(out);
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
        readCards();
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

    return () => {
      yCards.unobserve(readCards);
      try { aw?.off("change", onAw); } catch { /* noop */ }
      try { prov.destroy(); } catch { /* noop */ }
      try { yDoc.destroy(); } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, meta?.id]);

  // 14분마다 access_token 백그라운드 갱신 (장시간 보드 열어두는 수업 대응)
  useEffect(() => {
    const id = setInterval(() => {
      api.ensureFreshToken().catch(() => undefined);
    }, 14 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // ── 카드 조작 ─────────────────────────────────────────────────────────
  const canWrite = !!meta?.permission?.can_write && synced;
  const role = meta?.permission?.role;
  const isModerator = role === "owner" || role === "admin";

  const addCard = useCallback((column: number, text: string, color: string) => {
    const yCards = yCardsRef.current;
    if (!yCards || !user || !text.trim()) return;
    const id = `${user.id}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const card: BoardCard = {
      id,
      text: text.trim().slice(0, 2000),
      color,
      column,
      author_id: user.id,
      author_name: user.name || `#${user.id}`,
      created: Date.now(),
    };
    yCards.set(id, card);
  }, [user]);

  const updateCard = useCallback((card: BoardCard, patch: Partial<BoardCard>) => {
    const yCards = yCardsRef.current;
    if (!yCards) return;
    yCards.set(card.id, { ...card, ...patch });
  }, []);

  const deleteCard = useCallback((card: BoardCard) => {
    yCardsRef.current?.delete(card.id);
  }, []);

  // ── 렌더 (hooks는 early return 전에) ──────────────────────────────────
  const columns = meta && meta.columns.length > 0 ? meta.columns : ["보드"];
  const cardsByCol = useMemo(() => {
    const out: BoardCard[][] = Array.from({ length: columns.length }, () => []);
    for (const c of cards) {
      const ci = c.column >= 0 && c.column < columns.length ? c.column : 0;
      out[ci].push(c);
    }
    return out;
  }, [cards, columns.length]);

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

  return (
    <div
      className="rounded-2xl overflow-hidden shadow-lg min-h-[78vh] flex flex-col"
      style={{ background: bg.css }}
    >
      {/* 월 헤더 */}
      <div className="px-5 sm:px-7 pt-5 pb-3 flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className={`text-2xl font-extrabold tracking-tight ${tx} drop-shadow-sm`}>
            {meta.title}
          </h2>
          <div className={`text-caption mt-0.5 ${sub}`}>
            {meta.owner_name && <>{meta.owner_name} · </>}
            {meta.description || "포스트잇을 붙여보세요"}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
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
      </div>

      {/* 컬럼 그리드 */}
      <div
        className="flex-1 grid gap-3 sm:gap-4 items-start px-4 sm:px-6 pb-6 overflow-x-auto"
        style={{ gridTemplateColumns: `repeat(${Math.min(columns.length, 4)}, minmax(230px, 1fr))` }}
      >
        {columns.map((colName, ci) => (
          <BoardColumn
            key={ci}
            name={colName}
            dark={!!bg.dark}
            cards={cardsByCol[ci] || []}
            canWrite={canWrite}
            connecting={!synced}
            canModerate={isModerator}
            myUserId={user?.id}
            onAdd={(text, color) => addCard(ci, text, color)}
            onUpdate={updateCard}
            onDelete={deleteCard}
          />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function BoardColumn({
  name, dark, cards, canWrite, connecting, canModerate, myUserId, onAdd, onUpdate, onDelete,
}: {
  name: string;
  dark: boolean;
  cards: BoardCard[];
  canWrite: boolean;
  connecting: boolean;
  canModerate: boolean;
  myUserId?: number;
  onAdd: (text: string, color: string) => void;
  onUpdate: (card: BoardCard, patch: Partial<BoardCard>) => void;
  onDelete: (card: BoardCard) => void;
}) {
  const [composing, setComposing] = useState(false);

  const panel = dark ? "bg-white/10" : "bg-white/45";
  const headTx = dark ? "text-white" : "text-gray-900";
  const countChip = dark ? "bg-white/20 text-white" : "bg-white/70 text-gray-700";

  return (
    <div className={`${panel} backdrop-blur-[2px] rounded-2xl p-2.5 min-h-[220px]`}>
      <div className="flex items-center justify-between mb-2 px-1.5 pt-0.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-body font-bold truncate ${headTx}`}>{name}</span>
          <span className={`px-1.5 py-0.5 rounded-full text-[10.5px] font-semibold ${countChip}`}>
            {cards.length}
          </span>
        </div>
        {canWrite && !composing && (
          <button
            onClick={() => setComposing(true)}
            className="w-7 h-7 rounded-full bg-rose-500 hover:bg-rose-600 text-white flex items-center justify-center shadow-md transition flex-shrink-0"
            title="카드 추가"
          >
            <Plus size={15} />
          </button>
        )}
        {connecting && (
          <span className={`text-[10px] ${dark ? "text-white/60" : "text-gray-500"}`}>연결 중…</span>
        )}
      </div>

      <div className="space-y-2.5">
        {composing && (
          <Composer
            onSubmit={(text, color) => { onAdd(text, color); setComposing(false); }}
            onCancel={() => setComposing(false)}
          />
        )}
        {cards.map((c) => (
          <CardItem
            key={c.id}
            card={c}
            canEdit={canWrite && (c.author_id === myUserId || canModerate)}
            onUpdate={onUpdate}
            onDelete={onDelete}
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

function ColorDots({
  value, onChange,
}: { value: string; onChange: (c: string) => void }) {
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
  onSubmit, onCancel,
}: { onSubmit: (text: string, color: string) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState("");
  const [color, setColor] = useState(CARD_COLORS[0]);

  const submit = () => {
    if (!draft.trim()) return;
    onSubmit(draft, color);
  };

  return (
    <div
      className="rounded-xl p-3 shadow-lg border border-black/5"
      style={{ backgroundColor: color }}
    >
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
      <div className="flex items-center justify-between mt-1.5">
        <ColorDots value={color} onChange={setColor} />
        <div className="flex gap-1">
          <button
            onClick={onCancel}
            className="px-2 py-1 text-caption text-gray-500 hover:bg-black/5 rounded-lg"
          >
            취소
          </button>
          <button
            onClick={submit}
            disabled={!draft.trim()}
            className="px-3 py-1 text-caption bg-rose-500 hover:bg-rose-600 disabled:opacity-40 text-white rounded-lg font-semibold shadow-sm"
          >
            등록
          </button>
        </div>
      </div>
    </div>
  );
}

function CardItem({
  card, canEdit, onUpdate, onDelete,
}: {
  card: BoardCard;
  canEdit: boolean;
  onUpdate: (card: BoardCard, patch: Partial<BoardCard>) => void;
  onDelete: (card: BoardCard) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(card.text);
  const [color, setColor] = useState(card.color || CARD_COLORS[0]);

  const save = () => {
    const patch: Partial<BoardCard> = {};
    if (draft.trim() && draft !== card.text) patch.text = draft.trim().slice(0, 2000);
    if (color !== card.color) patch.color = color;
    if (Object.keys(patch).length > 0) onUpdate(card, patch);
    setEditing(false);
  };

  return (
    <div
      className="rounded-xl p-3 shadow-md border border-black/5 group transition hover:shadow-lg hover:-translate-y-px"
      style={{ backgroundColor: card.color || "#ffffff" }}
    >
      {editing ? (
        <div>
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
          <div className="text-body whitespace-pre-wrap break-words leading-relaxed">{card.text}</div>
          <div className="flex items-center justify-between mt-2.5">
            <span className="flex items-center gap-1.5 min-w-0">
              <span
                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
                style={{ backgroundColor: avatarColor(card.author_name || "") }}
              >
                {(card.author_name || "?").charAt(0)}
              </span>
              <span className="text-[11px] text-gray-500 truncate">
                {card.author_name} · {relTime(card.created)}
              </span>
            </span>
            {canEdit && (
              <span className="flex gap-0.5 opacity-0 group-hover:opacity-100 flex-shrink-0">
                <button
                  onClick={() => { setDraft(card.text); setColor(card.color || CARD_COLORS[0]); setEditing(true); }}
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
        </>
      )}
    </div>
  );
}
