"use client";

/**
 * 단어장 선택 모달 — 글 작성 시 단어장 첨부용 (ChatbotPickerModal 패턴).
 *
 * GET /api/tools/wordbook/decks → 본인 덱 목록.
 * 강좌 글에 첨부하면 그 강좌 수강생에게 학습 접근 권한이 부여된다.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { X, BookA, Loader2 } from "lucide-react";
import { api } from "@/lib/api/client";

interface DeckItem {
  id: number;
  title: string;
  description?: string | null;
  card_count: number;
  is_public: boolean;
}

interface Props {
  onClose: () => void;
  onSelect: (d: { word_deck_id: number; title: string }) => void;
}

export function WordDeckPickerModal({ onClose, onSelect }: Props) {
  const [items, setItems] = useState<DeckItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ items: DeckItem[] }>("/api/tools/wordbook/decks");
        if (!cancelled) setItems(res.items || []);
      } catch (e: any) {
        if (!cancelled) setError(e?.detail || e?.message || "단어장 목록을 불러올 수 없습니다");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-bg-primary rounded-lg shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col">
        <header className="flex items-center justify-between px-5 py-3 border-b border-border-default">
          <div className="flex items-center gap-2">
            <BookA size={18} className="text-sky-600" />
            <h2 className="text-body font-medium">단어장 첨부</h2>
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
          {items && items.length === 0 && (
            <div className="text-center py-8 text-text-tertiary">
              <BookA size={32} className="mx-auto mb-2 opacity-40" />
              <div className="text-caption">만든 단어장이 없습니다.</div>
              <div className="text-[11px] mt-1">
                <Link href="/tools/wordbook" target="_blank" className="underline">
                  도구 모음 → 단어장
                </Link>
                에서 먼저 만들어주세요.
              </div>
            </div>
          )}
          {items && items.length > 0 && (
            <ul className="space-y-2">
              {items.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect({ word_deck_id: d.id, title: d.title });
                      onClose();
                    }}
                    className="w-full text-left px-3 py-2.5 border border-border-default rounded hover:bg-sky-50 hover:border-sky-300 transition flex items-start gap-3"
                  >
                    <span className="text-[20px] flex-shrink-0">📚</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-body font-medium truncate">{d.title}</div>
                      <div className="text-[11px] text-text-tertiary">
                        {d.card_count}개 단어{d.is_public ? " · 공개" : ""}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <footer className="px-5 py-2.5 border-t border-border-default text-[11px] text-text-tertiary">
          첨부하면 이 강좌 수강생에게 학습 권한이 자동 부여됩니다.
        </footer>
      </div>
    </div>
  );
}
