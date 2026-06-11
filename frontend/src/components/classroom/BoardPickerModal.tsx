"use client";

/**
 * 보드 선택 모달 — 글 작성 시 보드 첨부용 (ChatbotPickerModal 패턴).
 *
 * GET /api/classroom/boards → 본인 보드 목록.
 * 강좌 글에 첨부하면 그 강좌 수강생에게 읽기+쓰기(카드 붙이기) 권한 부여.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { X, StickyNote, Loader2 } from "lucide-react";
import { api } from "@/lib/api/client";

interface BoardItem {
  id: number;
  title: string;
  description?: string | null;
  columns: string[];
  access_mode: string;
  owner_name?: string | null;
}

interface Props {
  onClose: () => void;
  onSelect: (b: { board_id: number; title: string }) => void;
}

export function BoardPickerModal({ onClose, onSelect }: Props) {
  const [items, setItems] = useState<BoardItem[] | null>(null);
  const [shared, setShared] = useState<BoardItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [mine, sh] = await Promise.all([
          api.get<{ items: BoardItem[] }>("/api/classroom/boards"),
          api.get<{ items: BoardItem[] }>("/api/classroom/boards/shared-with-me").catch(() => ({ items: [] })),
        ]);
        if (!cancelled) {
          setItems(mine.items || []);
          setShared(sh.items || []);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.detail || e?.message || "보드 목록을 불러올 수 없습니다");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 공유받은 보드 → 사본 생성 후 사본을 첨부 (원본 보존)
  const pickShared = async (b: BoardItem) => {
    if (duplicatingId) return;
    setDuplicatingId(b.id);
    try {
      const copy = await api.post<{ id: number; title: string }>(
        `/api/classroom/boards/${b.id}/duplicate`,
      );
      onSelect({ board_id: copy.id, title: copy.title });
      onClose();
    } catch (e: any) {
      alert(e?.detail || "사본 생성 실패");
      setDuplicatingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-bg-primary rounded-lg shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col">
        <header className="flex items-center justify-between px-5 py-3 border-b border-border-default">
          <div className="flex items-center gap-2">
            <StickyNote size={18} className="text-amber-600" />
            <h2 className="text-body font-medium">보드 첨부</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-bg-secondary rounded">
            <X size={16} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4">
          {items === null && !error && (
            <div className="flex items-center justify-center py-8 text-text-tertiary">
              <Loader2 size={16} className="animate-spin mr-2" /> 불러오는 중...
            </div>
          )}
          {error && <div className="text-caption text-status-error py-4">{error}</div>}
          {items && items.length === 0 && shared.length === 0 && (
            <div className="text-center py-8 text-text-tertiary">
              <StickyNote size={32} className="mx-auto mb-2 opacity-40" />
              <div className="text-caption">만든 보드가 없습니다.</div>
              <div className="text-[11px] mt-1">
                <Link href="/tools/board" target="_blank" className="underline">
                  도구 모음 → 보드
                </Link>
                에서 먼저 만들어주세요.
              </div>
            </div>
          )}
          {items && items.length > 0 && (
            <ul className="space-y-2">
              {items.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect({ board_id: b.id, title: b.title });
                      onClose();
                    }}
                    className="w-full text-left px-3 py-2.5 border border-border-default rounded hover:bg-amber-50 hover:border-amber-300 transition flex items-start gap-3"
                  >
                    <span className="text-[20px] flex-shrink-0">🗒️</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-body font-medium truncate">{b.title}</div>
                      <div className="text-[11px] text-text-tertiary truncate">
                        {b.columns.join(" · ")}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {shared.length > 0 && (
            <div className="mt-4">
              <div className="text-[11px] font-semibold text-violet-700 mb-1.5">
                나에게 공유됨 — 선택하면 사본을 만들어 첨부 (원본 보존)
              </div>
              <ul className="space-y-2">
                {shared.map((b) => (
                  <li key={`s-${b.id}`}>
                    <button
                      type="button"
                      disabled={duplicatingId !== null}
                      onClick={() => pickShared(b)}
                      className="w-full text-left px-3 py-2.5 border border-violet-200 bg-violet-50/40 rounded hover:bg-violet-50 hover:border-violet-300 transition flex items-start gap-3 disabled:opacity-50"
                    >
                      <span className="text-[20px] flex-shrink-0">🗒️</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-body font-medium truncate">
                          {duplicatingId === b.id ? "사본 만드는 중..." : b.title}
                        </div>
                        <div className="text-[11px] text-text-tertiary truncate">
                          {b.owner_name ? `${b.owner_name} 님 공유 · ` : ""}{b.columns.join(" · ")}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <footer className="px-5 py-2.5 border-t border-border-default text-[11px] text-text-tertiary">
          첨부하면 이 강좌 수강생이 카드를 붙일 수 있습니다.
        </footer>
      </div>
    </div>
  );
}
