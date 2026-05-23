"use client";

/**
 * 강좌 챗봇 선택 모달 — 글 작성 시 챗봇 첨부용.
 *
 * GET /api/classroom/courses/{cid}/chatbots → is_active=true만 표시
 * 1개 선택 → onSelect 호출 → modal close.
 *
 * 강좌에 챗봇이 없으면 "강좌 페이지의 챗봇 탭에서 먼저 만드세요" 안내.
 */

import { useEffect, useState } from "react";
import { X, Bot, Loader2 } from "lucide-react";
import { api } from "@/lib/api/client";

interface Chatbot {
  id: number;
  name: string;
  description?: string | null;
  is_active: boolean;
}

interface Props {
  cid: number;
  onClose: () => void;
  onSelect: (bot: { chatbot_id: number; title: string }) => void;
}

export function ChatbotPickerModal({ cid, onClose, onSelect }: Props) {
  const [bots, setBots] = useState<Chatbot[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ items: Chatbot[] }>(
          `/api/classroom/courses/${cid}/chatbots`,
        );
        if (!cancelled) {
          setBots((res.items || []).filter((b) => b.is_active));
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.detail || e?.message || "챗봇 목록을 불러올 수 없습니다");
      }
    })();
    return () => { cancelled = true; };
  }, [cid]);

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-bg-primary rounded-lg shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col">
        <header className="flex items-center justify-between px-5 py-3 border-b border-border-default">
          <div className="flex items-center gap-2">
            <Bot size={18} className="text-sky-600" />
            <h2 className="text-body font-medium">챗봇 첨부</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-bg-secondary rounded">
            <X size={16} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4">
          {bots === null && !error && (
            <div className="flex items-center justify-center py-8 text-text-tertiary">
              <Loader2 size={16} className="animate-spin mr-2" /> 불러오는 중...
            </div>
          )}
          {error && (
            <div className="text-caption text-status-error py-4">{error}</div>
          )}
          {bots && bots.length === 0 && (
            <div className="text-center py-8 text-text-tertiary">
              <Bot size={32} className="mx-auto mb-2 opacity-40" />
              <div className="text-caption">활성 챗봇이 없습니다.</div>
              <div className="text-[11px] mt-1">강좌 페이지의 "챗봇" 탭에서 먼저 만들어주세요.</div>
            </div>
          )}
          {bots && bots.length > 0 && (
            <ul className="space-y-2">
              {bots.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect({ chatbot_id: b.id, title: b.name });
                      onClose();
                    }}
                    className="w-full text-left px-3 py-2.5 border border-border-default rounded hover:bg-sky-50 hover:border-sky-300 transition flex items-start gap-3"
                  >
                    <span className="text-[20px] flex-shrink-0">🤖</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-body font-medium truncate">{b.name}</div>
                      {b.description && (
                        <div className="text-[11px] text-text-tertiary line-clamp-2">{b.description}</div>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
