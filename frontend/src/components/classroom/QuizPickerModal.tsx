"use client";

/**
 * 라이브 퀴즈 선택 모달 — 글 작성 시 퀴즈 첨부용 (ChatbotPickerModal 패턴).
 *
 * GET /api/tools/quiz/sessions → 본인 host 세션 목록 (진행 중 우선).
 * 1개 선택 → onSelect 호출 → modal close.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { X, Gamepad2, Loader2 } from "lucide-react";
import { api } from "@/lib/api/client";

interface QuizSession {
  id: number;
  title: string;
  pin: string;
  status: string;
  problem_count: number;
  player_count: number;
  created_at: string | null;
}

interface Props {
  onClose: () => void;
  onSelect: (q: { live_quiz_id: number; title: string }) => void;
}

export function QuizPickerModal({ onClose, onSelect }: Props) {
  const [items, setItems] = useState<QuizSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ items: QuizSession[] }>("/api/tools/quiz/sessions");
        if (!cancelled) {
          // 진행 중(미종료) 먼저, 그다음 최근 종료
          const list = res.items || [];
          list.sort((a, b) =>
            (a.status === "ended" ? 1 : 0) - (b.status === "ended" ? 1 : 0),
          );
          setItems(list);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.detail || e?.message || "퀴즈 목록을 불러올 수 없습니다");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-bg-primary rounded-lg shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col">
        <header className="flex items-center justify-between px-5 py-3 border-b border-border-default">
          <div className="flex items-center gap-2">
            <Gamepad2 size={18} className="text-violet-600" />
            <h2 className="text-body font-medium">라이브 퀴즈 첨부</h2>
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
              <Gamepad2 size={32} className="mx-auto mb-2 opacity-40" />
              <div className="text-caption">만든 퀴즈가 없습니다.</div>
              <div className="text-[11px] mt-1">
                <Link href="/tools/quiz" target="_blank" className="underline">
                  도구 모음 → 라이브 퀴즈
                </Link>
                에서 먼저 게임을 만들어주세요.
              </div>
            </div>
          )}
          {items && items.length > 0 && (
            <ul className="space-y-2">
              {items.map((q) => (
                <li key={q.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect({ live_quiz_id: q.id, title: q.title });
                      onClose();
                    }}
                    className="w-full text-left px-3 py-2.5 border border-border-default rounded hover:bg-violet-50 hover:border-violet-300 transition flex items-start gap-3"
                  >
                    <span className="text-[20px] flex-shrink-0">🎮</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-body font-medium truncate">{q.title}</div>
                      <div className="text-[11px] text-text-tertiary">
                        {q.status === "ended" ? "종료됨" : `PIN ${q.pin} · 진행 가능`}
                        {" · "}{q.problem_count}문제
                      </div>
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
