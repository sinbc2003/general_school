"use client";

/**
 * 화이트보드 선택 모달 — 글 작성 시 첨부용 (BoardPickerModal 패턴).
 * 본인 것 + 나에게 공유됨(선택 시 사본 생성 후 첨부 — 원본 보존).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { X, PenTool, Loader2 } from "lucide-react";
import { api } from "@/lib/api/client";

interface WbItem {
  id: number;
  title: string;
  description?: string | null;
  background?: string;
  owner_name?: string | null;
}

interface Props {
  onClose: () => void;
  onSelect: (w: { whiteboard_id: number; title: string }) => void;
}

export function WhiteboardPickerModal({ onClose, onSelect }: Props) {
  const [items, setItems] = useState<WbItem[] | null>(null);
  const [shared, setShared] = useState<WbItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [mine, sh] = await Promise.all([
          api.get<{ items: WbItem[] }>("/api/classroom/whiteboards"),
          api.get<{ items: WbItem[] }>("/api/classroom/whiteboards/shared-with-me").catch(() => ({ items: [] })),
        ]);
        if (!cancelled) {
          setItems(mine.items || []);
          setShared(sh.items || []);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.detail || e?.message || "목록을 불러올 수 없습니다");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const pickShared = async (w: WbItem) => {
    if (duplicatingId) return;
    setDuplicatingId(w.id);
    try {
      const copy = await api.post<{ id: number; title: string }>(
        `/api/classroom/whiteboards/${w.id}/duplicate`,
      );
      onSelect({ whiteboard_id: copy.id, title: copy.title });
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
            <PenTool size={18} className="text-violet-600" />
            <h2 className="text-body font-medium">화이트보드 첨부</h2>
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
              <PenTool size={32} className="mx-auto mb-2 opacity-40" />
              <div className="text-caption">만든 화이트보드가 없습니다.</div>
              <div className="text-[11px] mt-1">
                <Link href="/tools/whiteboard" target="_blank" className="underline">
                  도구 모음 → 화이트보드
                </Link>
                에서 먼저 만들어주세요.
              </div>
            </div>
          )}
          {items && items.length > 0 && (
            <ul className="space-y-2">
              {items.map((w) => (
                <li key={w.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect({ whiteboard_id: w.id, title: w.title });
                      onClose();
                    }}
                    className="w-full text-left px-3 py-2.5 border border-border-default rounded hover:bg-violet-50 hover:border-violet-300 transition flex items-start gap-3"
                  >
                    <span className="text-[20px] flex-shrink-0">🖊️</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-body font-medium truncate">{w.title}</div>
                      {w.description && (
                        <div className="text-[11px] text-text-tertiary truncate">{w.description}</div>
                      )}
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
                {shared.map((w) => (
                  <li key={`s-${w.id}`}>
                    <button
                      type="button"
                      disabled={duplicatingId !== null}
                      onClick={() => pickShared(w)}
                      className="w-full text-left px-3 py-2.5 border border-violet-200 bg-violet-50/40 rounded hover:bg-violet-50 hover:border-violet-300 transition flex items-start gap-3 disabled:opacity-50"
                    >
                      <span className="text-[20px] flex-shrink-0">🖊️</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-body font-medium truncate">
                          {duplicatingId === w.id ? "사본 만드는 중..." : w.title}
                        </div>
                        <div className="text-[11px] text-text-tertiary truncate">
                          {w.owner_name ? `${w.owner_name} 님 공유` : ""}
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
          첨부하면 이 강좌 수강생이 함께 그릴 수 있습니다.
        </footer>
      </div>
    </div>
  );
}
