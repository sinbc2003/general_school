"use client";

/**
 * 보드 (Padlet형) — 실시간 협업 담벼락. 교사/학생 공유 컴포넌트.
 *
 * 카드 데이터는 Yjs Y.Map("cards") — key=cardId, value=카드 객체.
 * HocuspocusProvider name=`board-{id}` (doc-/deck-/sheet- 패턴).
 * 카드 단위 LWW (같은 카드 동시 수정은 마지막 쓰기 승리 — 학교 환경 OK).
 *
 * 컬럼 레이아웃: 보드 메타(settings.columns)의 컬럼별로 카드 세로 나열.
 * 권한: backend _resolve_permission — can_write면 카드 추가/본인 카드 수정·삭제,
 *       보드 소유자/관리자는 모든 카드 삭제 가능.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import {
  Loader2, StickyNote, Plus, Trash2, Pencil, Check, X, Users, Wifi, WifiOff,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { useAuth } from "@/lib/auth-context";
import { getHocuspocusUrl } from "@/lib/collab/hocuspocus-url";

interface BoardMeta {
  id: number;
  title: string;
  description?: string | null;
  columns: string[];
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

const CARD_COLORS = ["#fef9c3", "#dbeafe", "#fce7f3", "#dcfce7", "#ede9fe", "#ffedd5"];

function randomColor(): string {
  return CARD_COLORS[Math.floor(Math.random() * CARD_COLORS.length)];
}

export function BoardView({ boardId }: { boardId: number }) {
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

  // ── Yjs + Hocuspocus ─────────────────────────────────────────────────
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
      out.sort((a, b) => (a.created || 0) - (b.created || 0));
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
  const canWrite = !!meta?.permission?.can_write;
  const isModerator = meta?.permission?.role === "owner" || meta?.permission?.role === "admin";

  const addCard = useCallback((column: number, text: string) => {
    const yCards = yCardsRef.current;
    if (!yCards || !user || !text.trim()) return;
    const id = `${user.id}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const card: BoardCard = {
      id,
      text: text.trim().slice(0, 2000),
      color: randomColor(),
      column,
      author_id: user.id,
      author_name: user.name || `#${user.id}`,
      created: Date.now(),
    };
    yCards.set(id, card);
  }, [user]);

  const updateCard = useCallback((card: BoardCard, text: string) => {
    const yCards = yCardsRef.current;
    if (!yCards || !text.trim()) return;
    yCards.set(card.id, { ...card, text: text.trim().slice(0, 2000) });
  }, []);

  const deleteCard = useCallback((card: BoardCard) => {
    yCardsRef.current?.delete(card.id);
  }, []);

  // ── 렌더 (hooks는 early return 전에) ──────────────────────────────────
  const columns = meta && meta.columns.length > 0 ? meta.columns : ["보드"];
  const cardsByCol = useMemoColumns(cards, columns.length);

  if (error) {
    return <div className="p-10 text-center text-body text-status-error">{error}</div>;
  }
  if (!meta || !synced) {
    return (
      <div className="flex items-center justify-center py-24 text-text-tertiary">
        <Loader2 size={20} className="animate-spin mr-2" />
        {meta ? "협업 서버 연결 중..." : "보드 불러오는 중..."}
      </div>
    );
  }

  return (
    <div>
      {/* 상태 바 */}
      <div className="flex items-center gap-3 mb-4 text-caption text-text-tertiary">
        <span className="inline-flex items-center gap-1">
          {connected
            ? <Wifi size={13} className="text-emerald-600" />
            : <WifiOff size={13} className="text-red-500" />}
          {connected ? "실시간 연결됨" : "연결 끊김 — 재연결 중"}
        </span>
        <span className="inline-flex items-center gap-1">
          <Users size={13} /> {activeCount}명 보는 중
        </span>
        {meta.is_archived && (
          <span className="px-1.5 py-0.5 bg-bg-secondary rounded text-[10px]">보관됨 (읽기 전용)</span>
        )}
      </div>

      {/* 컬럼 그리드 */}
      <div
        className="grid gap-4 items-start"
        style={{ gridTemplateColumns: `repeat(${Math.min(columns.length, 4)}, minmax(0, 1fr))` }}
      >
        {columns.map((colName, ci) => (
          <BoardColumn
            key={ci}
            name={colName}
            cards={cardsByCol[ci] || []}
            canWrite={canWrite}
            canModerate={isModerator}
            myUserId={user?.id}
            onAdd={(text) => addCard(ci, text)}
            onUpdate={updateCard}
            onDelete={deleteCard}
          />
        ))}
      </div>
    </div>
  );
}

/** 컬럼 index 범위 밖 카드는 0번 컬럼으로 (컬럼 삭제 후 잔존 카드 보호) */
function useMemoColumns(cards: BoardCard[], colCount: number): BoardCard[][] {
  return useMemo(() => {
    const out: BoardCard[][] = Array.from({ length: colCount }, () => []);
    for (const c of cards) {
      const ci = c.column >= 0 && c.column < colCount ? c.column : 0;
      out[ci].push(c);
    }
    return out;
  }, [cards, colCount]);
}

function BoardColumn({
  name, cards, canWrite, canModerate, myUserId, onAdd, onUpdate, onDelete,
}: {
  name: string;
  cards: BoardCard[];
  canWrite: boolean;
  canModerate: boolean;
  myUserId?: number;
  onAdd: (text: string) => void;
  onUpdate: (card: BoardCard, text: string) => void;
  onDelete: (card: BoardCard) => void;
}) {
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");

  const submit = () => {
    if (!draft.trim()) return;
    onAdd(draft);
    setDraft("");
    setComposing(false);
  };

  return (
    <div className="bg-bg-secondary/60 rounded-xl p-3 min-h-[200px]">
      <div className="flex items-center justify-between mb-2 px-1">
        <span className="text-body font-semibold">{name}</span>
        <span className="text-caption text-text-tertiary">{cards.length}</span>
      </div>

      <div className="space-y-2">
        {cards.map((c) => (
          <CardItem
            key={c.id}
            card={c}
            canEdit={canWrite && (c.author_id === myUserId || canModerate)}
            onUpdate={onUpdate}
            onDelete={onDelete}
          />
        ))}
      </div>

      {canWrite && (
        composing ? (
          <div className="mt-2 bg-bg-primary border border-border-default rounded-lg p-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit();
                if (e.key === "Escape") { setComposing(false); setDraft(""); }
              }}
              rows={3}
              placeholder="내용 입력 (Ctrl+Enter 등록)"
              autoFocus
              className="w-full text-body outline-none resize-none bg-transparent"
            />
            <div className="flex justify-end gap-1.5 mt-1">
              <button
                onClick={() => { setComposing(false); setDraft(""); }}
                className="px-2.5 py-1 text-caption text-text-tertiary hover:bg-bg-secondary rounded"
              >
                취소
              </button>
              <button
                onClick={submit}
                disabled={!draft.trim()}
                className="px-3 py-1 text-caption bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white rounded font-medium"
              >
                등록
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setComposing(true)}
            className="mt-2 w-full py-2 border border-dashed border-border-default rounded-lg text-caption text-text-tertiary hover:bg-bg-primary hover:text-text-primary inline-flex items-center justify-center gap-1"
          >
            <Plus size={13} /> 카드 추가
          </button>
        )
      )}
    </div>
  );
}

function CardItem({
  card, canEdit, onUpdate, onDelete,
}: {
  card: BoardCard;
  canEdit: boolean;
  onUpdate: (card: BoardCard, text: string) => void;
  onDelete: (card: BoardCard) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(card.text);

  const save = () => {
    if (draft.trim() && draft !== card.text) onUpdate(card, draft);
    setEditing(false);
  };

  return (
    <div
      className="rounded-lg p-3 shadow-sm border border-black/5 group"
      style={{ backgroundColor: card.color || "#fef9c3" }}
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
          <div className="flex justify-end gap-1 mt-1">
            <button onClick={() => setEditing(false)} className="p-1 text-text-tertiary hover:bg-black/5 rounded">
              <X size={13} />
            </button>
            <button onClick={save} className="p-1 text-emerald-700 hover:bg-black/5 rounded">
              <Check size={13} />
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="text-body whitespace-pre-wrap break-words">{card.text}</div>
          <div className="flex items-center justify-between mt-2">
            <span className="text-[10.5px] text-black/45">{card.author_name}</span>
            {canEdit && (
              <span className="flex gap-0.5 opacity-0 group-hover:opacity-100">
                <button onClick={() => { setDraft(card.text); setEditing(true); }} className="p-1 text-black/40 hover:text-black/70 rounded" title="수정">
                  <Pencil size={12} />
                </button>
                <button onClick={() => onDelete(card)} className="p-1 text-black/40 hover:text-red-600 rounded" title="삭제">
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
